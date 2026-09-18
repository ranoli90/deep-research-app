import type pg from "pg";
import type PgBoss from "pg-boss";
import { createHash } from "node:crypto";
import { buildApp } from "../api/app.js";
import { processRun } from "../worker/executor.js";
import { measureRunCost } from "../modules/run-cost.js";
import { getRun } from "../modules/runs.js";
import type { AppConfig } from "../platform/config.js";
import type { Authorization } from "./authorization.js";
import type { Driver,Exposure } from "./runner.js";
/** Evaluation composition only: original authenticated API and production worker, no evaluator gold. */
export async function productionDriver(pool:pg.Pool,boss:PgBoss,config:AppConfig,grant:Authorization,token:string):Promise<Driver&{close():Promise<void>}> {
 if(!token||!config.openRouterApiKey||!config.liveRouteEnabled||!config.structuredModelEnabled||!config.structuredDiscoveryEnabled||!config.liveRetrievalEnabled||config.fixtureRouteAllowed||config.liveSpendCapMicro<=0||!config.liveKeySpendCapMicro)throw new Error("production_route_not_enabled");
 const bounded={...config,liveBudgetScope:grant.budgetScope,liveSpendCapMicro:Math.min(config.liveSpendCapMicro,grant.budgetMicro),liveKeySpendCapMicro:Math.min(config.liveKeySpendCapMicro,grant.budgetMicro)};
 const headers={authorization:`Bearer ${token}`};
 const apps={A1:await buildApp({pool,boss,config:{...bounded,structuredStrategy:"iterative-baseline.v1"}}),B:await buildApp({pool,boss,config:{...bounded,structuredStrategy:"criterion-adaptive.v1"}})};
 const close=async()=>{await apps.A1.close();await apps.B.close();};
 try{
  const identity=await apps.A1.inject({method:"GET",url:"/v1/session",headers});
  if(identity.statusCode!==200||identity.json().accountId!==grant.accountId)throw new Error("evaluation_account_mismatch");
  if((await pool.query("SELECT 1 FROM runs WHERE account_id=$1 AND lifecycle!='terminal' LIMIT 1",[grant.accountId])).rowCount)throw new Error("prior_nonterminal_work_requires_review");
 }catch(e){await close();throw e;}
 const keyScope=createHash("sha256").update(`openrouter:${config.openRouterApiKey.trim()}`).digest("hex");
 return {
  close,
  async exposure():Promise<Exposure>{
   // Prior account, shared project scope, and same-key/unattributed liabilities all count.
   const q=await pool.query(`SELECT COALESCE(SUM(p.confirmed_micro),0)::text confirmed,
    COALESCE(SUM(CASE WHEN p.confirmed_micro IS NULL THEN p.reserved_max_micro ELSE 0 END),0)::text held,
    COUNT(*) FILTER(WHERE p.confirmed_micro IS NULL)::int unknown
    FROM provider_intents p LEFT JOIN runs r ON r.id=p.run_id WHERE p.route LIKE 'openrouter:%'
    AND(r.account_id=$1 OR p.scope_key=$2 OR p.provider_key_scope=$3 OR p.provider_key_scope IS NULL)`,[grant.accountId,grant.budgetScope,keyScope]);
   return {confirmedMicro:Number(q.rows[0].confirmed),heldMicro:Number(q.rows[0].held),unknownIntents:Number(q.rows[0].unknown)};
  },
  async admit(step,parent){
   const app=apps[step.arm];
   const response=step.kind==="correction"?await app.inject({method:"POST",url:`/v1/runs/${parent!.runId}/corrections`,headers:{...headers,"idempotency-key":step.idempotencyKey},payload:{expectedBriefRevision:parent!.briefRevision,correctionText:step.question,patch:{kind:"replace_question",question:step.question,evidencePolicy:"reuse_snapshot"}}}):await app.inject({method:"POST",url:"/v1/runs",headers:{...headers,"idempotency-key":step.idempotencyKey},payload:{question:step.question,routeMode:"controlled-research",attachmentIds:[]}});
   if(response.statusCode!==200||typeof response.json().runId!=="string")throw new Error("evaluation_admission_failed");
   return {runId:response.json().runId};
  },
  async execute(runId){
   let workerError:"worker_execution_unconfirmed"|undefined;
   try{await processRun(pool,bounded,runId);}catch{workerError="worker_execution_unconfirmed";}
   const run=await getRun(pool,runId);if(!run||run.account_id!==grant.accountId)throw new Error("evaluation_run_unavailable");
   const snap=await apps.A1.inject({method:"GET",url:`/v1/runs/${runId}`,headers});if(snap.statusCode!==200)throw new Error("evaluation_snapshot_unavailable");
   const snapshot=snap.json();let report:unknown=null;
   if(snapshot.reportId){const r=await apps.A1.inject({method:"GET",url:`/v1/reports/${snapshot.reportId}`,headers});if(r.statusCode!==200)throw new Error("evaluation_report_unavailable");report=r.json();}
   const cost=await measureRunCost(pool,runId,grant.accountId);if(!cost)throw new Error("evaluation_cost_unavailable");
   const passages=(await pool.query(`SELECT p.id,p.source_version_id,p.content_hash,p.exact_text,p.locator,p.extraction_method,v.access_level,v.content_hash AS source_digest FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$1 AND p.account_id=$2 ORDER BY p.id`,[runId,grant.accountId])).rows;
   const operations=(await pool.query("SELECT intent_id,operation,brief_revision,evidence_revision,schema_version,prompt_version,policy_id,input_manifest FROM model_operation_results WHERE run_id=$1 AND account_id=$2 ORDER BY intent_id",[runId,grant.accountId])).rows;
   const attempts=(await pool.query("SELECT id,action_id,route,request_digest,reserved_max_micro,confirmed_micro,state,receipt FROM provider_intents WHERE run_id=$1 ORDER BY id",[runId])).rows;
   const support=(await pool.query("SELECT model_intent_id,claim_revision_id,decision,result FROM scoped_support_results WHERE run_id=$1 AND account_id=$2",[runId,grant.accountId])).rows;
   const extraction=(await pool.query("SELECT DISTINCT e.source_version_id,e.artifact_id,e.transport,e.extraction FROM extraction_receipts e JOIN authorized_run_passages p ON p.source_version_id=e.source_version_id AND p.account_id=e.account_id WHERE p.run_id=$1 AND p.account_id=$2",[runId,grant.accountId])).rows;
   const artifacts=(await pool.query("SELECT DISTINCT a.id,a.digest,encode(a.body,'base64') AS bytes_base64 FROM evidence_artifacts a JOIN extraction_receipts e ON e.artifact_id=a.id AND e.account_id=a.account_id JOIN authorized_run_passages p ON p.source_version_id=e.source_version_id AND p.account_id=e.account_id WHERE p.run_id=$1 AND p.account_id=$2",[runId,grant.accountId])).rows;
   // A trace is evidence only when the stored raw bytes and every authorized derivation agree.
   for(const artifact of artifacts){
    if(createHash("sha256").update(Buffer.from(artifact.bytes_base64,"base64")).digest("hex")!==artifact.digest)throw new Error("evaluation_receipt_identity_unconfirmed");
   }
   for(const receipt of extraction){
    const artifact=artifacts.find(a=>a.id===receipt.artifact_id);
    const derived=passages.filter(p=>p.source_version_id===receipt.source_version_id);
    if(!artifact||receipt.transport?.digest!==artifact.digest||receipt.extraction?.digest!==artifact.digest||derived.length===0||derived.some(p=>p.source_digest!==artifact.digest||p.extraction_method!==receipt.extraction?.version))throw new Error("evaluation_receipt_identity_unconfirmed");
   }
   if(passages.some(p=>!extraction.some(e=>e.source_version_id===p.source_version_id)))throw new Error("evaluation_receipt_identity_unconfirmed");
   const reuse=(await pool.query("SELECT passage_id,source_version_id FROM run_evidence_membership WHERE run_id=$1 AND account_id=$2",[runId,grant.accountId])).rows;
   return {runId,...(workerError?{executionError:workerError}:{}),briefRevision:run.brief_revision,lifecycle:run.lifecycle,outcome:run.terminal_outcome,reportId:snapshot.reportId,cost:{confirmedMicro:cost.confirmedProviderMicro,heldMicro:cost.heldProviderMicro,unknownIntents:cost.unknownProviderIntents},trace:{workerError,strategy:run.research_strategy,snapshot,report,passages,operations,attempts,support,extraction,artifacts,reuse,cost}};
  },
 };
}
