import { createHash } from "node:crypto";
import { afterAll,afterEach,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema,CorrectionRequestSchema } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { createDevSession,grantConsent,revokeConsent,deleteAccount } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitResearchCorrection } from "../src/modules/research-corrections.js";
import { getBrief,getRun } from "../src/modules/runs.js";
import { insertSource,insertVersionAndPassage } from "../src/modules/evidence.js";
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
let pool:pg.Pool;const accounts:string[]=[];
const question="Compare 😀 tools below €40 in Germany.";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);});
afterEach(async()=>{for(const account of accounts.splice(0))await deleteAccount(pool,account);});
afterAll(async()=>{await pool.end();});
async function owner(){const s=await withTx(pool,async db=>{const o=await createDevSession(db);await grantConsent(db,o.accountId);return o;});accounts.push(s.accountId);return s;}
async function setup(){const account=await owner();const parent=await admitRun(pool,account.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:"controlled-research"}));
 const start=question.indexOf("€40"),patch={kind:"replace_question_span",originalQuestionSha256:createHash("sha256").update(question).digest("hex"),start,end:start+3,quote:"€40",replacement:"€70",evidencePolicy:"reuse_snapshot"};
 const input=CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Raise only this budget; this note is not appended.",patch});return {...account,parent,input};}
it("W06 exact span creates server-derived child and preserves whole accepted patch without rewriting parent",async()=>{
 const x=await setup(),child=await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);
 const run=(await getRun(pool,child.runId))!,brief=await getBrief(pool,run.brief_id);
 expect(brief.originalQuestion).toBe("Compare 😀 tools below €70 in Germany.");expect(brief.originalQuestion).not.toContain(x.input.correctionText);
 const parent=(await getRun(pool,x.parent.runId))!;expect((await getBrief(pool,parent.brief_id)).originalQuestion).toBe(question);
 const change=(await pool.query("SELECT patch,dependency_completeness,reopen_discovery FROM research_change_sets WHERE run_id=$1",[child.runId])).rows[0];
 expect(change).toMatchObject({patch:{patch:x.input.patch,acceptedText:x.input.correctionText},dependency_completeness:"unknown",reopen_discovery:true});
 expect(child.fullRerun).toBe(true);expect((await pool.query("SELECT 1 FROM run_dispatch_outbox WHERE run_id=$1",[child.runId])).rowCount).toBe(1);
 expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[child.runId])).rowCount).toBe(0);
});
it("W02 concurrent exact replay reserves and dispatches one child, while accepted-note changes remain distinct",async()=>{
 const x=await setup(),children=await Promise.all(Array.from({length:3},()=>admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input)));
 expect(new Set(children.map(c=>c.runId)).size).toBe(1);expect(children.filter(c=>!c.reused)).toHaveLength(1);
 expect((await pool.query("SELECT 1 FROM reservations WHERE run_id=$1",[children[0]!.runId])).rowCount).toBe(1);
 const other=await admitResearchCorrection(pool,x.accountId,x.parent.runId,{...x.input,correctionText:"Different explicit accepted note"});expect(other.runId).not.toBe(children[0]!.runId);
});
it("W03/W06 foreign owner, stale revision, revoked consent, wrong digest/quote and split Unicode cannot admit child",async()=>{
 const x=await setup(),foreign=await owner();
 await expect(admitResearchCorrection(pool,foreign.accountId,x.parent.runId,x.input)).rejects.toThrow("correction_parent_unavailable");
 await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,{...x.input,expectedBriefRevision:2})).rejects.toThrow("stale_revision");
 for(const patch of [{originalQuestionSha256:"0".repeat(64)},{quote:"€50"},{start:question.indexOf("😀"),end:question.indexOf("😀")+1,quote:"\ud83d"}])await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,CorrectionRequestSchema.parse({...x.input,patch:{...x.input.patch,...patch}}))).rejects.toThrow("question_patch_");
 await revokeConsent(pool,x.accountId);await expect(admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input)).rejects.toThrow("consent_required");
 expect((await pool.query("SELECT 1 FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rowCount).toBe(0);
});
it("W06 snapshot and refresh retain existing immutable membership and conservative recomputation policies",async()=>{
 const x=await setup();const sourceId=await insertSource(pool,{accountId:x.accountId,runId:x.parent.runId,locator:"https://example.org/patch-control",title:"Synthetic",publisher:"Synthetic",originCluster:"example.org"});
 const passage=await insertVersionAndPassage(pool,{accountId:x.accountId,runId:x.parent.runId,sourceId,locator:"https://example.org/patch-control",text:"Synthetic source evidence.",accessLevel:"full-text"});
 const snapshot=await admitResearchCorrection(pool,x.accountId,x.parent.runId,x.input);
 const refresh=await admitResearchCorrection(pool,x.accountId,x.parent.runId,CorrectionRequestSchema.parse({...x.input,patch:{...x.input.patch,evidencePolicy:"refresh"}}));
 expect((await pool.query("SELECT passage_id FROM run_evidence_membership WHERE run_id=$1",[snapshot.runId])).rows.map(r=>r.passage_id)).toEqual([passage.passageId]);
 expect((await pool.query("SELECT 1 FROM run_evidence_membership WHERE run_id=$1",[refresh.runId])).rowCount).toBe(0);
 for(const runId of [snapshot.runId,refresh.runId])expect((await pool.query("SELECT dependency_completeness,reopen_discovery FROM research_change_sets WHERE run_id=$1",[runId])).rows[0]).toEqual({dependency_completeness:"unknown",reopen_discovery:true});
});
it("W06 existing whole-question correction still derives exact child question and replays",async()=>{
 const x=await setup(),input=CorrectionRequestSchema.parse({...x.input,patch:{kind:"replace_question",question:"Which tools work offline?",evidencePolicy:"refresh"}});
 const child=await admitResearchCorrection(pool,x.accountId,x.parent.runId,input);expect((await getBrief(pool,(await getRun(pool,child.runId))!.brief_id)).originalQuestion).toBe("Which tools work offline?");
 expect(await admitResearchCorrection(pool,x.accountId,x.parent.runId,input)).toMatchObject({runId:child.runId,reused:true});
});
it("W06 explicit empty-span insertion and removal are server-derived while invalid result creates no child",async()=>{
 const x=await setup();
 const apply=(patch:Record<string,unknown>)=>admitResearchCorrection(pool,x.accountId,x.parent.runId,CorrectionRequestSchema.parse({...x.input,patch:{...x.input.patch,...patch}}));
 const inserted=await apply({start:0,end:0,quote:"",replacement:"Please "});
 expect((await getBrief(pool,(await getRun(pool,inserted.runId))!.brief_id)).originalQuestion).toBe(`Please ${question}`);
 const removed=await apply({start:0,end:8,quote:"Compare ",replacement:""});
 expect((await getBrief(pool,(await getRun(pool,removed.runId))!.brief_id)).originalQuestion).toBe("😀 tools below €40 in Germany.");
 const before=(await pool.query("SELECT count(*)::int AS n FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rows[0].n;
 await expect(apply({start:0,end:question.length,quote:question,replacement:" "})).rejects.toThrow("question_patch_invalid_result");
 expect((await pool.query("SELECT count(*)::int AS n FROM runs WHERE parent_run_id=$1",[x.parent.runId])).rows[0].n).toBe(before);
});
