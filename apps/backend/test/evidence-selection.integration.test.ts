import {readFileSync} from "node:fs";
/** Nonbillable real PostgreSQL ownership, replay, publication and deletion controls. */
import {createHash} from "node:crypto";
import {afterAll,afterEach,beforeAll,expect,it} from "vitest";
import type pg from "pg";
import {CreateRunRequestSchema,type CanonicalReport} from "@deep/contracts";
import {createPool,migrate,withTx} from "../src/platform/db.js";
import {createDevSession,grantConsent,deleteAccount} from "../src/modules/access.js";
import {admitRun} from "../src/modules/run-admission.js";
import {insertSource,insertExtractedVersion} from "../src/modules/evidence.js";
import {claimLease} from "../src/modules/runs.js";
import {fencedSession,type FencedSession} from "../src/worker/fenced-session.js";
import {prepareEvidenceSelection,restoreEvidenceSelection,evidenceSelectionLimitations,validateSelectionContext} from "../src/modules/evidence-selections.js";
import {reportCompletionCovered} from "../src/modules/publication-coverage.js";
import {deleteSourceForAccount} from "../src/modules/source-deletion.js";
let pool:pg.Pool;const accounts:string[]=[],sessions:FencedSession[]=[];
beforeAll(async()=>{pool=createPool(process.env.TEST_DATABASE_URL!);await migrate(pool);});
afterEach(async()=>{for(const s of sessions.splice(0))s.stop();for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await pool.end();});
async function setup(count=150){
 const accountId=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s.accountId;});accounts.push(accountId);
 const run=await admitRun(pool,accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Does Solace support offline recording?",routeMode:"controlled-research"}));
 const args={accountId,runId:run.runId,briefRevision:1};
 const sourceId=await addEvidence(args,count),owner=crypto.randomUUID(),fence=(await claimLease(pool,run.runId,owner,60000))!;
 const session=fencedSession(pool,{...args,owner,fence,leaseMs:60000});sessions.push(session);return {...args,session,sourceId,fence};
}
async function addEvidence(args:{accountId:string;runId:string},count:number){
 const locator=`https://example.org/${crypto.randomUUID()}`,sourceId=await insertSource(pool,{...args,locator,title:"Synthetic selection control",publisher:"Synthetic",originCluster:"synthetic",sourceType:"web"});
 const texts=Array.from({length:count},(_,i)=>i===count-1?"Solace supports offline recording only on firmware 4.2.":`Background ${i} ${"x".repeat(1000)}`),bytes=Buffer.from(texts.join("\n"));
 await insertExtractedVersion(pool,{...args,sourceId,bytes,receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},extraction:{version:"utf8-notes-v1",digest:createHash("sha256").update(bytes).digest("hex"),status:"extracted",warnings:[],blocks:texts.map((text,i)=>({kind:"text",locator:`paragraph:${i}`,text,rows:[]}))}});return sourceId;
}
async function selected(x:Awaited<ReturnType<typeof setup>>){const s=await x.session.write(db=>prepareEvidenceSelection(db,x));expect(s.kind).toBe("selected");if(s.kind!=="selected")throw new Error(s.reason);return s;}
it("W05 serializes two concurrent fenced selections to one exact proof on separate connections",async()=>{
 const x=await setup();const [a,b]=await Promise.all([selected(x),selected(x)]);expect(a).toEqual(b);expect(a.context.omitted).toBeGreaterThan(0);
 expect((await pool.query("SELECT count(*)::int AS n FROM evidence_selections WHERE run_id=$1",[x.runId])).rows[0].n).toBe(1);
 expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
 const rows=(await pool.query("SELECT exact_text FROM authorized_run_passages WHERE run_id=$1 AND id=ANY($2::uuid[])",[x.runId,a.passageIds])).rows;
 expect(rows.some(r=>r.exact_text==="Solace supports offline recording only on firmware 4.2.")).toBe(true);
});
it("W05 restores the original inventory after new evidence and creates a distinct current selection",async()=>{
 const x=await setup(),a=await selected(x);await addEvidence(x,2);await pool.query("UPDATE runs SET evidence_revision=evidence_revision+1 WHERE id=$1",[x.runId]);const old=await restoreEvidenceSelection(pool,{...x,selectionId:a.context.id});expect(old.context).toEqual(a.context);
 const b=await selected(x);expect(b.context.id).not.toBe(a.context.id);expect(b.context.available).toBe(a.context.available+2);
 await expect(validateSelectionContext(pool,{...x,evidenceRevision:b.evidenceRevision,selection:a.context,passageIds:a.passageIds})).rejects.toThrow("selection_context_mismatch");
});
it("W01 rejects missing limitation and completed outcome even with a limited caller flag",async()=>{
 const x=await setup(),s=await selected(x),warnings=await evidenceSelectionLimitations(pool,x);expect(warnings).toHaveLength(1);expect(warnings[0]).toContain(`selected ${s.context.selected} of 150`);
 const report={runId:x.runId,basis:{briefRevision:1,evidenceRevision:s.evidenceRevision},outcome:"completed_with_limitations",limitations:[],blocks:[],claimIds:[]} as unknown as CanonicalReport;
 expect(await reportCompletionCovered(pool,x.accountId,report)).toBe(false);
 expect(await reportCompletionCovered(pool,x.accountId,{...report,limitations:warnings})).toBe(true);
 expect(await reportCompletionCovered(pool,x.accountId,{...report,limitations:warnings,outcome:"completed"})).toBe(false);
});
it("W02 does not recreate lost proof or issue a new logical action",async()=>{
 const x=await setup(),s=await selected(x);await pool.query("DELETE FROM evidence_selections WHERE id=$1",[s.context.id]);
 await expect(x.session.write(db=>prepareEvidenceSelection(db,x))).rejects.toThrow("required_selection_proof_missing");
 await expect(evidenceSelectionLimitations(pool,x)).rejects.toThrow("required_selection_proof_missing");
 expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
});
it.each(["text","digest","locator","result"])("W01 rejects changed %s in the immutable proof",async mode=>{
 const x=await setup(),s=await selected(x);
 if(mode==="result")await pool.query("UPDATE evidence_selections SET selection=jsonb_set(selection,'{omitted}','0') WHERE id=$1",[s.context.id]);
 else if(mode==="text")await pool.query("UPDATE passages SET exact_text='altered' WHERE id=$1",[s.passageIds[0]]);
 else if(mode==="digest")await pool.query("UPDATE passages SET content_hash=repeat('a',64) WHERE id=$1",[s.passageIds[0]]);
 else await pool.query("UPDATE passages SET locator='{}' WHERE id=$1",[s.passageIds[0]]);
 await expect(restoreEvidenceSelection(pool,{...x,selectionId:s.context.id})).rejects.toThrow(mode==="result"?"selection_result_changed":"selection_evidence_changed");
});
it("W03 refuses wrong owner/run/revision and purges inventory on source deletion",async()=>{
 const x=await setup(),y=await setup(2),s=await selected(x);
 for(const args of [{...x,accountId:y.accountId},{...y},{...x,briefRevision:2}])await expect(restoreEvidenceSelection(pool,{...args,selectionId:s.context.id})).rejects.toThrow();
 await deleteSourceForAccount(pool,x.accountId,x.sourceId);expect((await pool.query("SELECT count(*)::int AS n FROM evidence_selections WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
 await expect(x.session.write(db=>prepareEvidenceSelection(db,x))).rejects.toThrow("stale_worker");
});
it("W03 account deletion purges metadata and stale workers cannot select",async()=>{
 const x=await setup();await selected(x);await deleteAccount(pool,x.accountId);
 expect((await pool.query("SELECT count(*)::int AS n FROM evidence_selections WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
 await expect(x.session.write(db=>prepareEvidenceSelection(db,x))).rejects.toThrow("stale_worker");
});

it("W01 rejects lost obligation markers and unversioned candidate additions",async()=>{
 const x=await setup(),s=await selected(x);await pool.query("UPDATE runs SET evidence_selection_required_revision=NULL WHERE id=$1",[x.runId]);
 await expect(evidenceSelectionLimitations(pool,x)).rejects.toThrow("selection_obligation_missing");
 await addEvidence(x,1);await expect(restoreEvidenceSelection(pool,{...x,selectionId:s.context.id})).rejects.toThrow("selection_inventory_changed_without_revision");
});

it("W02 migration backfills legacy identities, defaults only new runs, and replays without changing either",async()=>{
 const db=await pool.connect(),schema=`selection_migration_${crypto.randomUUID().replaceAll("-","")}`;
 try{await db.query("BEGIN");await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET LOCAL search_path TO ${schema},public`);
 await db.query("CREATE TABLE accounts(id uuid PRIMARY KEY); CREATE TABLE runs(id uuid PRIMARY KEY)");
 const oldId=crypto.randomUUID(),newId=crypto.randomUUID();await db.query("INSERT INTO runs(id) VALUES($1)",[oldId]);
 const sql=readFileSync(new URL("../migrations/038_evidence_selections.sql",import.meta.url),"utf8");await db.query(sql);await db.query("INSERT INTO runs(id) VALUES($1)",[newId]);await db.query(sql);
 const rows=(await db.query("SELECT id,evidence_selection_policy FROM runs")).rows;
 expect(rows.find(r=>r.id===oldId).evidence_selection_policy).toBe("legacy-all.v1");expect(rows.find(r=>r.id===newId).evidence_selection_policy).toBe("whole-passage-selection.v1");
 }finally{await db.query("ROLLBACK");db.release();}
});

it("W02 recovery migration retains old policy and stamps only new admissions on repeated application",async()=>{
 const db=await pool.connect();try{await db.query("BEGIN");const schema=`recovery_${crypto.randomUUID().replaceAll('-','')}`;await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET LOCAL search_path TO ${schema}`);
 await db.query("CREATE TABLE runs(id uuid PRIMARY KEY)");const oldId=crypto.randomUUID(),newId=crypto.randomUUID();await db.query("INSERT INTO runs(id) VALUES($1)",[oldId]);
 const sql=readFileSync(new URL("../migrations/040_empty_selection_recovery.sql",import.meta.url),"utf8");await db.query(sql);await db.query("INSERT INTO runs(id) VALUES($1)",[newId]);await db.query(sql);
 expect((await db.query("SELECT evidence_recovery_policy FROM runs WHERE id=$1",[oldId])).rows[0].evidence_recovery_policy).toBe("none.v1");
 expect((await db.query("SELECT evidence_recovery_policy FROM runs WHERE id=$1",[newId])).rows[0].evidence_recovery_policy).toBe("empty-selection-recovery.v1");
 }finally{await db.query("ROLLBACK");db.release();}
});
