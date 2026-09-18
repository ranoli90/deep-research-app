import { restoreEvidenceSelection } from "../modules/evidence-selections.js";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { createHash } from "node:crypto";
import { buildApp } from "../api/app.js";
import { processRun } from "../worker/executor.js";
import { measureRunCost } from "../modules/run-cost.js";
import { getRun,getBrief } from "../modules/runs.js";
import type { AppConfig } from "../platform/config.js";
import {sha256,type Authorization } from "./authorization.js";
import type { Driver,Exposure,Journal } from "./runner.js";
import {stepKey} from "./runner.js";
import type {FrozenDocuments} from "./frozen-documents.js";
/** Evaluation composition only: original authenticated API and production worker, no evaluator gold. */
export async function productionDriver(pool:pg.Pool,boss:PgBoss,config:AppConfig,grant:Authorization,token:string,documents?:FrozenDocuments,journal?:Journal):Promise<Driver&{close():Promise<void>}> {
 if(!token||!config.openRouterApiKey||!config.liveRouteEnabled||!config.structuredModelEnabled||(grant.sourceMode==="live_discovery"&&(!config.structuredDiscoveryEnabled||!config.liveRetrievalEnabled))||config.fixtureRouteAllowed||config.liveSpendCapMicro<=0||!config.liveKeySpendCapMicro)throw new Error("production_route_not_enabled");
 const bounded={...config,...(grant.sourceMode==="frozen_supplied_document"?{structuredDiscoveryEnabled:false,liveRetrievalEnabled:false,structuredChallengeEnabled:false}:{}),liveBudgetScope:grant.budgetScope,liveSpendCapMicro:Math.min(config.liveSpendCapMicro,grant.budgetMicro),liveKeySpendCapMicro:Math.min(config.liveKeySpendCapMicro,grant.budgetMicro)};
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
   const attachmentIds:string[]=[];
   if(grant.sourceMode==="frozen_supplied_document"){
    if(step.unavailableReason||!step.sources?.length||step.sources.length>3||new Set(step.sources.map(s=>s.id)).size!==step.sources.length)throw new Error("frozen_sources_unavailable");
    for(const source of step.sources){
     const document=documents?.get(source.id);
     if(!document||document.source.sha256!==source.sha256||document.source.file!==source.file||document.source.mime!==source.mime||!["application/pdf","text/html"].includes(source.mime)||sha256(document.bytes)!==source.sha256)throw new Error("frozen_document_digest_mismatch");
    }
    if(step.kind!=="correction")for(const source of step.sources){
     if(Date.now()>=Date.parse(grant.expiresAt))throw new Error("approval_expired");
     const uploaded=await app.inject({method:"POST",url:"/v1/attachments/bytes",headers:{...headers,"content-type":"application/octet-stream","x-document-mime":source.mime,"x-file-name":encodeURIComponent(source.file),"idempotency-key":stepKey(grant.approvalId,`${step.id}:upload:${source.id}`)},payload:documents!.get(source.id)!.bytes});
     if(uploaded.statusCode!==201||typeof uploaded.json().attachmentId!=="string")throw new Error("frozen_upload_unconfirmed");
     attachmentIds.push(uploaded.json().attachmentId);
     await journal?.({event:"supplied_document_upload",stepId:step.id,sourceId:source.id,attachmentId:uploaded.json().attachmentId,sha256:source.sha256,sizeBytes:documents!.get(source.id)!.bytes.length,provenance:"frozen_public_corpus_bytes_admitted_as_owned_attachment"});
    }
   }
   if(Date.now()>=Date.parse(grant.expiresAt))throw new Error("approval_expired");
   const response=step.kind==="correction"?await app.inject({method:"POST",url:`/v1/runs/${parent!.runId}/corrections`,headers:{...headers,"idempotency-key":step.idempotencyKey},payload:{expectedBriefRevision:parent!.briefRevision,correctionText:step.question,patch:{kind:"replace_question",question:step.question,evidencePolicy:"reuse_snapshot"}}}):await app.inject({method:"POST",url:"/v1/runs",headers:{...headers,"idempotency-key":step.idempotencyKey},payload:{question:step.question,routeMode:"controlled-research",attachmentIds}});
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
   const selections=(await pool.query("SELECT id,brief_revision,evidence_revision,version,question_digest,required_ids,candidates,selection,proof_digest FROM evidence_selections WHERE run_id=$1 AND account_id=$2 ORDER BY id",[runId,grant.accountId])).rows;
   for(const selection of selections)await restoreEvidenceSelection(pool,{runId,accountId:grant.accountId,briefRevision:run.brief_revision,selectionId:selection.id});
   const attempts=(await pool.query("SELECT id,action_id,route,request_digest,reserved_max_micro,confirmed_micro,state,receipt FROM provider_intents WHERE run_id=$1 ORDER BY id",[runId])).rows;
   const support=(await pool.query("SELECT model_intent_id,claim_revision_id,decision,result FROM scoped_support_results WHERE run_id=$1 AND account_id=$2",[runId,grant.accountId])).rows;
   const inventorySupport=(await pool.query("SELECT selection_id,claim_revision_id,support_intent_id,checker_version,input_digest,scope_digest,evidence_digest,decision,result FROM selection_inventory_checks WHERE run_id=$1 AND account_id=$2",[runId,grant.accountId])).rows;
   const extraction=(await pool.query("SELECT DISTINCT e.source_version_id,e.artifact_id,e.transport,e.extraction,v.content_hash AS source_digest FROM extraction_receipts e JOIN source_versions v ON v.id=e.source_version_id AND v.account_id=e.account_id JOIN sources s ON s.id=v.source_id AND s.account_id=v.account_id WHERE e.account_id=$2 AND (s.run_id=$1 OR EXISTS(SELECT 1 FROM authorized_run_passages p WHERE p.source_version_id=v.id AND p.account_id=$2 AND p.run_id=$1))",[runId,grant.accountId])).rows;
   const artifacts=(await pool.query("SELECT DISTINCT a.id,a.digest,encode(a.body,'base64') AS bytes_base64 FROM evidence_artifacts a JOIN extraction_receipts e ON e.artifact_id=a.id AND e.account_id=a.account_id JOIN source_versions v ON v.id=e.source_version_id AND v.account_id=e.account_id JOIN sources s ON s.id=v.source_id AND s.account_id=v.account_id WHERE e.account_id=$2 AND (s.run_id=$1 OR EXISTS(SELECT 1 FROM authorized_run_passages p WHERE p.source_version_id=v.id AND p.account_id=$2 AND p.run_id=$1))",[runId,grant.accountId])).rows;
   // A trace is evidence only when the stored raw bytes and every authorized derivation agree.
   for(const artifact of artifacts){
    if(createHash("sha256").update(Buffer.from(artifact.bytes_base64,"base64")).digest("hex")!==artifact.digest)throw new Error("evaluation_receipt_identity_unconfirmed");
   }
   for(const receipt of extraction){
    const artifact=artifacts.find(a=>a.id===receipt.artifact_id);
    const derived=passages.filter(p=>p.source_version_id===receipt.source_version_id);
    // A failed read may legitimately have no body or no extractor output. This is
    // a failure receipt, never evidence: its empty/unavailable shape must match
    // insertExtractedVersion, and successful-body receipts cannot use this path.
    const outcome=receipt.transport?.outcome;
    const absentExtraction=receipt.extraction?.status==="unavailable"&&
      Array.isArray(receipt.extraction.blocks)&&receipt.extraction.blocks.length===0&&
      receipt.extraction.digest===undefined&&receipt.extraction.version===undefined&&
      Array.isArray(receipt.extraction.warnings)&&receipt.extraction.warnings.length===1&&receipt.extraction.warnings[0]===outcome;
    if(receipt.artifact_id===null){
     if(!artifact&&derived.length===0&&receipt.source_digest===null&&receipt.transport?.digest===null&&
       receipt.transport.bytes===0&&receipt.transport.status===null&&absentExtraction&&
       (outcome==="fetch_unavailable"||outcome==="extraction_unavailable"))continue;
     throw new Error("evaluation_receipt_identity_unconfirmed");
    }
    if(!artifact||receipt.source_digest!==artifact.digest||receipt.transport?.digest!==artifact.digest||receipt.transport.bytes!==Buffer.from(artifact.bytes_base64,"base64").length)throw new Error("evaluation_receipt_identity_unconfirmed");
    const retainedUnextractedFailure=derived.length===0&&absentExtraction&&
      ((outcome==="unavailable_status"&&Number.isInteger(receipt.transport.status)&&(receipt.transport.status<200||receipt.transport.status>=300))||
       (outcome==="extraction_unavailable"&&Number.isInteger(receipt.transport.status)&&receipt.transport.status>=200&&receipt.transport.status<300));
    if((receipt.extraction?.digest!==artifact.digest&&!retainedUnextractedFailure)||
      derived.some(p=>p.source_digest!==artifact.digest||p.extraction_method!==receipt.extraction?.version))throw new Error("evaluation_receipt_identity_unconfirmed");
   }
   if(passages.some(p=>!extraction.some(e=>e.source_version_id===p.source_version_id)))throw new Error("evaluation_receipt_identity_unconfirmed");
   const events=(await pool.query("SELECT id,run_id,account_id,sequence::text,type,public_summary,phase,payload,created_at FROM run_events WHERE run_id=$1 AND account_id=$2 ORDER BY run_events.sequence",[runId,grant.accountId])).rows;
   const brief=await getBrief(pool,run.brief_id);
   const supplied=(await pool.query("SELECT id,filename,mime,sha256,size_bytes,processing_state,extraction FROM attachments WHERE account_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",[grant.accountId,brief.attachmentIds])).rows;
   const reuse=(await pool.query("SELECT passage_id,source_version_id FROM run_evidence_membership WHERE run_id=$1 AND account_id=$2",[runId,grant.accountId])).rows;
   return {runId,...(workerError?{executionError:workerError}:{}),briefRevision:run.brief_revision,lifecycle:run.lifecycle,outcome:run.terminal_outcome,reportId:snapshot.reportId,cost:{confirmedMicro:cost.confirmedProviderMicro,heldMicro:cost.heldProviderMicro,unknownIntents:cost.unknownProviderIntents},trace:{workerError,strategy:run.research_strategy,snapshot,report,passages,operations,selections,attempts,support,inventorySupport,extraction,artifacts,supplied,events,reuse,cost}};
  },
 };
}
