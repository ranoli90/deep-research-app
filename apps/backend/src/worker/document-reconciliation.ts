import type pg from "pg";
import { resolveScopedSupport, type ScopedSupportResult } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { loadSupportContext, type SupportArgs } from "../modules/scoped-support.js";
import { runModelVersions } from "../modules/run-model-policy.js";
import { getRun } from "../modules/runs.js";
import { persistReconciliation, type ScopedReconciliationResult } from "../modules/retrieval-intelligence.js";
import type { ModelContext } from "../ports/model.js";
import type { FencedSession } from "./fenced-session.js";
import { performModelOperation } from "./model-gateway.js";

type PublicPassage=ModelContext["passages"][number]&{sourceId:string};
const tokens=(text:string)=>new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
/** Lexical relevance orders work only. Semantic status always comes from an executed assessment. */
export function reconciliationOutcome(check:ScopedSupportResult|undefined,omitted:number):ScopedReconciliationResult["outcome"] {
 if(!check)return "unverifiable";
 if(check.decision==="contradicted"&&check.modelStatus==="contradicted")return "contradicted";
 if(check.decision==="disputed")return "partially_confirmed";
 if(check.decision==="supported"&&check.modelStatus==="supported")return omitted?"partially_confirmed":"confirmed";
 if(["supported","partially_supported"].includes(check.decision)&&check.modelStatus==="partially_supported")return "partially_confirmed";
 return "unverifiable";
}

/** Private claims are assessed against owned public passages, never against their own document as confirmation. */
export async function executeDocumentReconciliation(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs&{fence:number}) {
 const versions=await session.write(db=>runModelVersions(db,args.runId));
 const basis=await session.write(db=>loadSupportContext(db,args,versions));
 const owned=await session.write(async db=>(await db.query<PublicPassage&{locator:string}>(`SELECT p.id,p.source_version_id AS "sourceVersionId",p.content_hash AS digest,
  p.exact_text AS text,v.access_level AS "accessLevel",s.id AS "sourceId",s.canonical_locator AS locator
  FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
  WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND s.account_id=$1 ORDER BY p.id`,[args.accountId,args.runId])).rows);
 const documentIds=new Set(owned.filter(p=>p.locator.startsWith("attachment://")).map(p=>p.id));
 const publicPassages=owned.filter(p=>!p.locator.startsWith("attachment://")&&["partial-text","full-text"].includes(p.accessLevel));
 const critical=new Set(basis.context.task?.questions.filter(q=>q.importance==="critical").flatMap(q=>q.criterionKeys)??[]);
 const claims=basis.context.assertions.filter(a=>a.evidence.some(e=>documentIds.has(e.passageId)))
  .sort((a,b)=>Number(b.criterionKeys.some(k=>critical.has(k)))-Number(a.criterionKeys.some(k=>critical.has(k)))||a.key.localeCompare(b.key));
 const evidenceRevision=(await getRun(pool,args.runId))!.evidence_revision;
 for(let index=0;index<claims.length;index++) {
  const claim=claims[index]!;
  const words=tokens(claim.text);
  const score=(p:PublicPassage)=>[...tokens(p.text)].filter(w=>words.has(w)).length;
  const ranked=[...publicPassages].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const selected:PublicPassage[]=[];
  let bytes=0;
  if(index<8)for(const p of ranked){const size=Buffer.byteLength(p.text,"utf8");if(selected.length<16&&bytes+size<=48_000){selected.push(p);bytes+=size;}}
  const selectedIds=new Set(selected.map(p=>p.id));
  const omitted=publicPassages.filter(p=>!selectedIds.has(p.id)).map(p=>p.id);
  let check:ScopedSupportResult|undefined;
  let reason=index>=8?"Claim assessment limit reached; this claim remains unassessed.":"No readable public evidence was available for this private claim.";
  const modelIntentIds:string[]=[];
  if(selected.length){
   const context:ModelContext={...basis.context,evidenceSelection:undefined,scopeComparison:undefined,calculations:undefined,
    passages:selected.map(({sourceId:_,...p})=>({id:p.id,sourceVersionId:p.sourceVersionId,digest:p.digest,text:p.text,accessLevel:p.accessLevel})),
    sources:[],assertions:[claim],approvedClaimKeys:[],draft:null};
   const assessed=await performModelOperation(pool,config,session,{...args,evidenceRevision,context,operation:"assess_support"});
   if(assessed.kind==="pending")return assessed;
   if(assessed.kind==="result"){
    modelIntentIds.push(assessed.intentId);
    if(assessed.result.receipt.actualMicro===null)return {kind:"pending" as const,intentId:assessed.intentId};
    if(assessed.result.status==="succeeded"){
     check=resolveScopedSupport({assertions:[claim],passages:context.passages,proposal:assessed.result.output})[0];
     reason=check?.rationale??"No scoped assessment was returned.";
    }else reason=`Public evidence assessment unavailable: ${assessed.result.status}.`;
   }else reason=`Public evidence assessment unavailable: ${assessed.reason}.`;
  }
  const result:ScopedReconciliationResult={version:"document-web-reconciliation.v3",claimKey:claim.key,
   outcome:reconciliationOutcome(check,omitted.length),permissionRequired:false,
   // No search is issued by reconciliation; already owned passages are inspected under model consent.
   queryAuthorization:{kind:"authorized",query:"",terms:[],privateTermsRequiringApproval:[]},
   sourceScope:{version:"document-web-reconciliation.v3",sourceIds:[...new Set(selected.map(p=>p.sourceId))],accessLevels:[...new Set(selected.map(p=>p.accessLevel))],
    extractionIntentId:args.extractionIntentId,modelIntentIds,inspectedPassageIds:selected.map(p=>p.id),omittedPassageIds:omitted,briefRevision:args.briefRevision,evidenceRevision},
   rationale:reason+(omitted.length?` ${omitted.length} public passages were not assessed for this claim; coverage is incomplete.`:"")};
  await session.write(db=>persistReconciliation(db,{...args,result}));
 }
 return {kind:"reconciled" as const,count:claims.length};
}
