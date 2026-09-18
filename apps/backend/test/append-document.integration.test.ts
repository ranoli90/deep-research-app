import { storeAttachment } from "../src/modules/attachments.js";
import { afterAll,afterEach,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { CreateRunRequestSchema,CorrectionRequestSchema } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { createDevSession,grantConsent,revokeConsent,deleteAccount } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitResearchCorrection,resolveResearchCorrection } from "../src/modules/research-corrections.js";
import { getBrief,getRun } from "../src/modules/runs.js";
import { insertSource,insertVersionAndPassage } from "../src/modules/evidence.js";
import { deleteSourceForAccount } from "../src/modules/source-deletion.js";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig } from "../src/platform/config.js";
const url=process.env.TEST_DATABASE_URL!;let pool:pg.Pool,boss:PgBoss,app:FastifyInstance;const accounts:string[]=[];
const question="Which firmware supports this sensor?";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);boss=await createQueue(url);app=await buildApp({pool,boss,config:loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",DEV_ALLOW_FIXTURE_ROUTE:"false",LIVE_ROUTE_ENABLED:"false"})});});
afterEach(async()=>{for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await app.close();await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function owner(){const a=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});accounts.push(a.accountId);return a;}
async function attachment(accountId:string){return (await storeAttachment(pool,{accountId,filename:"synthetic.txt",mime:"text/plain",bytes:Buffer.from("Synthetic evidence"),extractedText:"Synthetic evidence"}))!;}
async function setup(count=1){const a=await owner(),old:string[]=[];for(let i=0;i<count;i++)old.push(await attachment(a.accountId));const added=await attachment(a.accountId),parent=await admitRun(pool,a.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:"controlled-research",attachmentIds:old}));const input=CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Add this document without changing the question.",patch:{kind:"append_attachments",attachmentIds:[added],evidencePolicy:"reuse_snapshot"}});return{...a,parent,input,old,added};}
it("W06 appends owned documents, preserves question and exact old evidence, and records no public rediscovery",async()=>{
 const x=await setup(),sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.parent.runId,locator:"https://example.org/prior",title:"Public prior evidence",publisher:"Synthetic",originCluster:"synthetic"});const evidence=await insertVersionAndPassage(pool,{accountId:x.accountId,runId:x.parent.runId,sourceId,locator:"https://example.org/prior",text:"Prior exact evidence",accessLevel:"full-text"});
 const child=await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input),brief=await getBrief(pool,(await getRun(pool,child.runId))!.brief_id);expect(brief.originalQuestion).toBe(question);expect(brief.attachmentIds).toEqual([...x.old,x.added]);expect((await getBrief(pool,(await getRun(pool,x.parent.runId))!.brief_id)).attachmentIds).toEqual(x.old);
 expect((await pool.query("SELECT passage_id,source_version_id FROM run_evidence_membership WHERE run_id=$1",[child.runId])).rows).toEqual([{passage_id:evidence.passageId,source_version_id:evidence.versionId}]);
 expect((await pool.query("SELECT patch,reopen_discovery,dependency_completeness FROM research_change_sets WHERE run_id=$1",[child.runId])).rows[0]).toMatchObject({patch:{patch:x.input.patch,acceptedText:x.input.correctionText},reopen_discovery:false,dependency_completeness:"unknown"});
 expect((await pool.query("SELECT 1 FROM claims WHERE run_id=$1",[child.runId])).rowCount).toBe(0);expect((await pool.query("SELECT 1 FROM run_dispatch_outbox WHERE run_id=$1",[child.runId])).rowCount).toBe(1);
});
it("W02 concurrent whole-patch replay admits and reserves one child only",async()=>{const x=await setup(),children=await Promise.all(Array.from({length:3},()=>admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input)));expect(new Set(children.map(c=>c.runId)).size).toBe(1);expect(children.filter(c=>!c.reused)).toHaveLength(1);expect((await pool.query("SELECT 1 FROM reservations WHERE run_id=$1",[children[0]!.runId])).rowCount).toBe(1);});
it("W03 rejects foreign/deleted/already-present/too-many attachments, stale parent and revoked consent before child creation",async()=>{
 const x=await setup(3),other=await owner(),foreign=await attachment(other.accountId),removed=await attachment(x.accountId);await pool.query("UPDATE attachments SET deleted_at=now() WHERE id=$1",[removed]);
 const patch=(id:string)=>CorrectionRequestSchema.parse({...x.input,patch:{...x.input.patch,attachmentIds:[id]}});
 await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input)).rejects.toThrow("attachment_append_invalid");
 const fewer=await setup(),ownRemoved=await attachment(fewer.accountId);await pool.query("UPDATE attachments SET deleted_at=now() WHERE id=$1",[ownRemoved]);for(const id of [foreign,ownRemoved])await expect(admitResearchCorrection(pool,fewer.accountId,fewer.parent.runId,patch(id))).rejects.toThrow("attachment_unavailable");
 await expect(admitResearchCorrection(pool,fewer.accountId,fewer.parent.runId,patch(fewer.old[0]!.toUpperCase()))).rejects.toThrow("attachment_append_invalid");
 await expect(admitResearchCorrection(pool,fewer.accountId,fewer.parent.runId,{...fewer.input,expectedBriefRevision:2})).rejects.toThrow("stale_revision");
 await revokeConsent(pool,fewer.accountId);await expect(admitResearchCorrection(pool,fewer.accountId,fewer.parent.runId,fewer.input)).rejects.toThrow("consent_required");
 expect((await pool.query("SELECT 1 FROM runs WHERE parent_run_id=ANY($1::uuid[])",[[x.parent.runId,fewer.parent.runId]])).rowCount).toBe(0);
});
it.each(["append","whole"])("W02 exact %s correction withdrawal blocks every delayed admission",async kind=>{const x=await setup();const input=kind==="append"?x.input:CorrectionRequestSchema.parse({...x.input,patch:{kind:"replace_question",question:"New question",evidencePolicy:"reuse_snapshot"}});expect(await resolveResearchCorrection(pool,x.accountId,x.parent.runId,input)).toEqual({status:"withdrawn"});await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,input)).rejects.toThrow("idempotency_withdrawn");expect((await pool.query("SELECT 1 FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rowCount).toBe(0);});
it("W07 actual API resolves exact accepted correction with route and consent disabled; wrong owner and tampered binding cannot adopt",async()=>{
 const x=await setup(),child=await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);await revokeConsent(pool,x.accountId);const headers={authorization:`Bearer ${x.token}`},path=`/v1/runs/${x.parent.runId}/corrections/resolve`;
 const recovered=await app.inject({method:"POST",url:path,headers,payload:x.input});expect(recovered.statusCode).toBe(200);expect(recovered.json()).toMatchObject({status:"accepted",run:{runId:child.runId,labeledDemo:false}});
 expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
 const other=await owner();expect((await app.inject({method:"POST",url:path,headers:{authorization:`Bearer ${other.token}`},payload:x.input})).statusCode).toBe(404);
 expect((await app.inject({method:"POST",url:path,headers,payload:{...x.input,authority:"extra"}})).statusCode).toBe(400);
 await pool.query("UPDATE research_change_sets SET patch='{}' WHERE run_id=$1",[child.runId]);expect((await app.inject({method:"POST",url:path,headers,payload:x.input})).statusCode).toBe(409);
});
it("W03 source deletion withdraws accepted child identity and prevents replay/adoption",async()=>{
 const x=await setup(),sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.parent.runId,locator:`attachment://${x.old[0]}`,title:"Original",publisher:"Synthetic",originCluster:"synthetic"});await insertVersionAndPassage(pool,{accountId:x.accountId,runId:x.parent.runId,sourceId,locator:`attachment://${x.old[0]}`,text:"Original",accessLevel:"full-text"});
 await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);await deleteSourceForAccount(pool,x.accountId,sourceId);expect(await resolveResearchCorrection(pool,x.accountId,x.parent.runId,x.input)).toEqual({status:"withdrawn"});await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input)).rejects.toThrow("correction_parent_unavailable");
});
it("W07 actual settings advertises append only when configured, and enabled API accepts the typed patch",async()=>{
 const x=await setup(),headers={authorization:`Bearer ${x.token}`};expect((await app.inject({method:"GET",url:"/v1/settings",headers})).json().appendDocumentsAllowed).toBe(false);
 const enabled=await buildApp({pool,boss,config:loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-append-api",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000000"})});
 try{expect((await enabled.inject({method:"GET",url:"/v1/settings",headers})).json().appendDocumentsAllowed).toBe(true);const response=await enabled.inject({method:"POST",url:`/v1/runs/${x.parent.runId}/corrections`,headers,payload:x.input});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({parentRunId:x.parent.runId,fullRerun:true});expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[response.json().runId])).rowCount).toBe(0);}finally{await enabled.close();}
});
async function waitForBlockedAccount(blockerPid:number){for(let i=0;i<100;i++){const blocked=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%accounts%FOR UPDATE%' AND $1=ANY(pg_blocking_pids(pid))",[blockerPid]);if(blocked.rowCount)return;await new Promise(r=>setTimeout(r,10));}throw Error("account_lock_barrier_timeout");}
it("W03 an unrelated blocked account cannot satisfy the deletion ordering barrier",async()=>{
 const first=await owner(),second=await owner(),holder=await pool.connect(),unrelated=await pool.connect(),waiter=await pool.connect();
 let waiting:Promise<unknown>|undefined;
 try{
  await holder.query("BEGIN");await holder.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[first.accountId]);
  await unrelated.query("BEGIN");await unrelated.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[second.accountId]);
  waiting=waiter.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[first.accountId]);
  await waitForBlockedAccount((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  await expect(waitForBlockedAccount((await unrelated.query("SELECT pg_backend_pid() AS pid")).rows[0].pid)).rejects.toThrow("account_lock_barrier_timeout");
 }finally{await holder.query("ROLLBACK");await waiting;await unrelated.query("ROLLBACK");holder.release();unrelated.release();waiter.release();}
});
it("W02 real account-lock barrier lets withdrawal win before delayed append admission",async()=>{
 const x=await setup(),lock=await pool.connect();await lock.query("BEGIN");await lock.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[x.accountId]);
 let resolved:ReturnType<typeof resolveResearchCorrection>,admitted:ReturnType<typeof admitResearchCorrection>;
 try{resolved=resolveResearchCorrection(pool,x.accountId,x.parent.runId,x.input);await waitForBlockedAccount((await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);admitted=admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);const rejected=expect(admitted).rejects.toThrow("idempotency_withdrawn");await lock.query("COMMIT");expect(await resolved).toEqual({status:"withdrawn"});await rejected;}finally{await lock.query("ROLLBACK");lock.release();}
 expect((await pool.query("SELECT 1 FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rowCount).toBe(0);
});
it("W03 deletion winning the account lock prevents a waiting append from reviving the document",async()=>{
 const x=await setup(),sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.parent.runId,locator:`attachment://${x.old[0]}`,title:"Prior",publisher:"Synthetic",originCluster:"synthetic"}),lock=await pool.connect();await lock.query("BEGIN");await lock.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[x.accountId]);
 try{const deletion=deleteSourceForAccount(pool,x.accountId,sourceId);await waitForBlockedAccount((await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);const admission=admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);const rejected=expect(admission).rejects.toThrow("correction_parent_unavailable");await lock.query("COMMIT");await deletion;await rejected;}finally{await lock.query("ROLLBACK");lock.release();}
 expect((await pool.query("SELECT 1 FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rowCount).toBe(0);
});
it("W06 missing immutable parent basis fails before parsing or fresh model spending even without a change-set",async()=>{
 const x=await setup(),child=await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);await pool.query("DELETE FROM research_change_sets WHERE run_id=$1",[child.runId]);await pool.query("UPDATE research_briefs SET payload='{}' WHERE id=(SELECT brief_id FROM runs WHERE id=$1)",[x.parent.runId]);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected_provider_call");};
 try{const {processRun}=await import("../src/worker/executor.js");await processRun(pool,loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-parent-basis",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000000"}),child.runId);}finally{globalThis.fetch=original;}
 expect(calls).toBe(0);expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[child.runId])).rows[0].payload.reason).toBe("correction_parent_basis_unavailable");expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
});
