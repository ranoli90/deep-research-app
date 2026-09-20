import {runModelVersions,runModelPolicy} from "./run-model-policy.js";
import { prepareEvidenceSelection,usesEvidenceSelection } from "./evidence-selections.js";
import { EvidenceSelectionContextSchema } from "../ports/evidence-selection.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { COUNTEREVIDENCE_VERSION,CounterevidenceActionSchema,CounterevidenceOutcomeSchema,ResearchModelOutputs,RESEARCH_MODEL_SCHEMA_VERSION } from "@deep/contracts";
import { counterevidenceOutcome,counterevidenceQuestion,counterevidenceSearch,resolveScopedSupport,SCOPED_SUPPORT_VERSION,selectCounterevidenceAction } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { ModelReceiptSchema } from "../ports/model.js";
import { MODEL_PROMPT_VERSION } from "../ports/model-policy.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "./scoped-support.js";
import { loadAssertionEvidence } from "./assertion-evidence.js";
import { loadModelOperation,modelInputManifest } from "./model-operations.js";
import { getRun } from "./runs.js";
import { discoveryPolicyForNewSearch,SearchResultSchema,publicSearchDigest } from "../ports/search.js";
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export const counterevidenceDigest=(v:unknown)=>createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const Target=z.object({claimId:z.string().uuid(),claimRevisionId:z.string().uuid(),assertion:ResearchModelOutputs.extract_assertions.shape.assertions.element,initialResult:z.unknown()}).strict();
const Targets=z.array(Target).min(1).max(6);
const CounterevidenceRow=z.object({id:z.string().uuid(),account_id:z.string().uuid(),run_id:z.string().uuid(),task_id:z.string().uuid(),brief_revision:z.number().int(),version:z.string(),
 extraction_intent_id:z.string().uuid(),initial_support_intent_id:z.string().uuid(),original_evidence_revision:z.number().int(),original_evidence_digest:z.string(),
 action:CounterevidenceActionSchema,targets:Targets,targets_digest:z.string(),search_intent_id:z.string().uuid().nullable(),
 read_operations:z.array(z.object({operationId:z.string().uuid(),sourceVersionId:z.string().uuid(),readable:z.boolean()}).strict()).max(3),
 state:z.enum(["planned","read","checked","blocked","unknown"]),outcome:CounterevidenceOutcomeSchema.nullable(),reason:z.string().nullable(),evidence_revision:z.number().int().nullable(),
 evidence_digest:z.string().nullable(),model_intent_id:z.string().uuid().nullable(),context_manifest:z.unknown(),result:z.unknown(),checker_version:z.string().nullable()});
type SavedCounterevidence=z.infer<typeof CounterevidenceRow>;
export async function getCounterevidence(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}) {
 const rows=await db.query("SELECT * FROM counterevidence_checks WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision]);
 if(rows.rowCount&& (rows.rowCount!==1||rows.rows[0].version!==COUNTEREVIDENCE_VERSION))throw new Error("unsupported_challenge_version");
 if(!rows.rows[0])return null;
 const parsed=CounterevidenceRow.safeParse(rows.rows[0]);
 if(!parsed.success)throw new Error("challenge_proof_unreadable");
 return parsed.data;
}
/** Persist original targets before any evidence-changing action. Never recover them from re-extraction. */
export async function prepareCounterevidence(db:Queryable,args:SupportArgs&{supportIntentId:string}) {
 const versions=await runModelVersions(db,args.runId);
 const prior=await getCounterevidence(db,args);if(prior){await validateTargets(db,prior);return prior;}
 const required=await db.query("SELECT 1 FROM runs WHERE id=$1 AND account_id=$2 AND counterevidence_required_revision=$3",[args.runId,args.accountId,args.briefRevision]);
 if(required.rowCount)throw new Error("required_challenge_proof_missing");
 const basis=await loadSupportContext(db,args,versions);
 const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
 const action=selectCounterevidenceAction(basis.context.task!,basis.context.assertions,checks);if(!action)return null;
 const targets=action.claimKeys.map(key=>{const check=checks.find(c=>c.claimKey===key)!;const {claimId,claimRevisionId,...initialResult}=check;
  return {claimId,claimRevisionId,assertion:basis.context.assertions.find(a=>a.key===key)!,initialResult};});
 await db.query(`INSERT INTO counterevidence_checks(id,account_id,run_id,task_id,brief_revision,version,extraction_intent_id,initial_support_intent_id,
 original_evidence_revision,original_evidence_digest,action,targets,targets_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
 ON CONFLICT(run_id,brief_revision,version) DO NOTHING`,[crypto.randomUUID(),args.accountId,args.runId,args.taskId,args.briefRevision,COUNTEREVIDENCE_VERSION,args.extractionIntentId,args.supportIntentId,
 basis.evidenceRevision,counterevidenceDigest(modelInputManifest(basis.context).passages),JSON.stringify(action),JSON.stringify(targets),counterevidenceDigest(targets)]);
 await db.query("UPDATE runs SET counterevidence_required_revision=$3 WHERE id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision]);
 const saved=await getCounterevidence(db,args);if(!saved)throw new Error("challenge_missing");await validateTargets(db,saved);return saved;
}
async function validateTargets(db:Queryable,row:SavedCounterevidence) {
 const versions=await runModelVersions(db,row.run_id);
 const targets=Targets.parse(row.targets),action=CounterevidenceActionSchema.parse(row.action);
 if(action.question!==counterevidenceQuestion(targets.map(t=>t.assertion.text))||row.version!==COUNTEREVIDENCE_VERSION||counterevidenceDigest(targets)!==row.targets_digest||JSON.stringify(action.claimKeys)!==JSON.stringify(targets.map(t=>t.assertion.key)))throw new Error("challenge_target_digest_mismatch");
 const task=(await db.query("SELECT criterion_ids,question_ids FROM research_tasks WHERE id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4",[row.task_id,row.account_id,row.run_id,row.brief_revision])).rows[0];
 if(!task||action.questionKeys.some(k=>!task.question_ids[k]))throw new Error("challenge_task_mismatch");
 const revisionScopes=new Map<string,unknown>();
 for(const target of targets) {
  const claim=(await db.query(`SELECT c.text,r.text AS revision_text,r.text_digest,r.scope,s.result,s.evidence_revision,s.evidence_digest FROM extracted_assertions a
   JOIN claims c ON c.id=a.claim_id JOIN claim_revisions r ON r.id=a.claim_revision_id
   JOIN scoped_support_results s ON s.extraction_intent_id=a.extraction_intent_id AND s.claim_key=a.claim_key AND s.claim_revision_id=r.id
   WHERE a.extraction_intent_id=$1 AND a.claim_key=$2 AND a.account_id=$3 AND a.run_id=$4 AND a.task_id=$5
   AND a.claim_id=$6 AND a.claim_revision_id=$7 AND c.account_id=$3 AND c.run_id=$4 AND r.account_id=$3 AND r.run_id=$4 AND r.claim_id=c.id
   AND s.model_intent_id=$8 AND s.account_id=$3 AND s.run_id=$4 AND s.task_id=$5 AND s.brief_revision=$9 AND s.checker_version=$10 AND s.decision='supported'`,
   [row.extraction_intent_id,target.assertion.key,row.account_id,row.run_id,row.task_id,target.claimId,target.claimRevisionId,row.initial_support_intent_id,row.brief_revision,SCOPED_SUPPORT_VERSION])).rows[0];
  if(!claim||claim.text!==target.assertion.text||claim.revision_text!==target.assertion.text||claim.text_digest!==createHash("sha256").update(target.assertion.text).digest("hex")||
    counterevidenceDigest(claim.scope.semanticScope)!==counterevidenceDigest(target.assertion.scope)||counterevidenceDigest(claim.scope.quantities)!==counterevidenceDigest(target.assertion.quantities)||
    counterevidenceDigest(claim.result)!==counterevidenceDigest(target.initialResult)||claim.evidence_revision!==row.original_evidence_revision||
    counterevidenceDigest(claim.scope.criterionIds)!==counterevidenceDigest(target.assertion.criterionKeys.map(k=>task.criterion_ids[k])))throw new Error("challenge_original_target_changed");
  revisionScopes.set(target.assertion.key,claim.scope);
 }
 // Restore both original model receipts and the original selected evidence without pretending the old run revision is current.
 const extraction=(await db.query(`SELECT * FROM model_operation_results WHERE intent_id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4 AND evidence_revision=$5
 AND operation='extract_assertions' AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,[row.extraction_intent_id,row.account_id,row.run_id,row.brief_revision,row.original_evidence_revision,RESEARCH_MODEL_SCHEMA_VERSION,MODEL_PROMPT_VERSION,versions.policyId])).rows[0];
 if(!extraction)throw new Error("challenge_original_extraction_unavailable");
 const original=await loadAssertionEvidence(db,{runId:row.run_id,accountId:row.account_id,briefRevision:row.brief_revision,taskId:row.task_id,
  selectionId:z.object({evidenceSelection:EvidenceSelectionContextSchema.optional()}).parse(extraction.input_manifest).evidenceSelection?.id,
  passageIds:z.object({passages:z.array(z.object({id:z.string().uuid()}))}).parse(extraction.input_manifest).passages.map(p=>p.id)},versions);
 if(original.kind!=="basis"||original.context.passages.some(p=>createHash("sha256").update(p.text).digest("hex")!==p.digest))throw new Error("challenge_original_evidence_changed");
 if(counterevidenceDigest(modelInputManifest(original.context).passages)!==row.original_evidence_digest)throw new Error("challenge_original_evidence_digest_mismatch");
 const parsedExtraction=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.extract_assertions,receipt:ModelReceiptSchema}).strict().parse(await loadModelOperation(db,row.extraction_intent_id,row.run_id,row.account_id,extraction.request_digest,original.context));
 const originalContext={...original.context,assertions:parsedExtraction.output.assertions};
 const support=(await db.query(`SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4 AND evidence_revision=$5
 AND operation='assess_support' AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,[row.initial_support_intent_id,row.account_id,row.run_id,row.brief_revision,row.original_evidence_revision,RESEARCH_MODEL_SCHEMA_VERSION,MODEL_PROMPT_VERSION,versions.policyId])).rows[0];
 if(!support)throw new Error("challenge_original_support_unavailable");
 const parsedSupport=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.assess_support,receipt:ModelReceiptSchema}).strict().parse(await loadModelOperation(db,row.initial_support_intent_id,row.run_id,row.account_id,support.request_digest,originalContext));
 if(parsedExtraction.receipt.actualMicro===null||parsedSupport.receipt.actualMicro===null)throw new Error("challenge_initial_receipt_unknown");
 const initialChecks=resolveScopedSupport({assertions:originalContext.assertions,passages:originalContext.passages,proposal:parsedSupport.output});
 for(const target of targets) {
  const expectedScope={taskId:row.task_id,semanticScope:target.assertion.scope,quantities:target.assertion.quantities,criterionIds:target.assertion.criterionKeys.map(k=>task.criterion_ids[k]),
   evidence:target.assertion.evidence.map(e=>({...e,sourceVersionId:originalContext.passages.find(p=>p.id===e.passageId)?.sourceVersionId,digest:originalContext.passages.find(p=>p.id===e.passageId)?.digest}))};
  if(counterevidenceDigest(originalContext.assertions.find(a=>a.key===target.assertion.key))!==counterevidenceDigest(target.assertion)||
   counterevidenceDigest(initialChecks.find(c=>c.claimKey===target.assertion.key))!==counterevidenceDigest(target.initialResult)||
   counterevidenceDigest(revisionScopes.get(target.assertion.key))!==counterevidenceDigest(expectedScope))throw new Error("challenge_initial_proof_changed");
 }
 return targets;
}
export async function counterevidenceContext(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}) {
 const versions=await runModelVersions(db,args.runId);
 const row=await getCounterevidence(db,args);if(!row)throw new Error("challenge_missing");
 const targets=await validateTargets(db,row);
 const selection=await usesEvidenceSelection(db,args)?await prepareEvidenceSelection(db,{...args,requiredIds:targets.flatMap(t=>t.assertion.evidence.map(e=>e.passageId))}):null;
 if(selection&&selection.kind!=="selected")return {kind:"blocked" as const,reason:selection.reason,row};
 const legacy=selection?null:await db.query<{id:string}>(`SELECT p.id FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id
 WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND v.access_level IN ('partial-text','full-text') ORDER BY p.id`,[args.accountId,args.runId]);
 const basis=await loadAssertionEvidence(db,{...args,taskId:row.task_id,passageIds:selection?selection.passageIds:legacy!.rows.map(p=>p.id),selectionId:selection?.context.id},versions);
 if(basis.kind!=="basis")return {kind:"blocked" as const,reason:basis.blocked,row};
 // All initial target quotes must remain authorized and exact in the selected fresh evidence.
 for(const t of targets)for(const quote of t.assertion.evidence){const p=basis.context.passages.find(p=>p.id===quote.passageId);
  if(!p||p.text.slice(quote.start,quote.end)!==quote.quote)throw new Error("challenge_original_evidence_unavailable");}
 return {...basis,row,targets,context:{...basis.context,assertions:targets.map(t=>t.assertion)}};
}
export async function persistCounterevidenceResult(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;modelIntentId:string},requireStored=false) {
 const versions=await runModelVersions(db,args.runId);
 const basis=await counterevidenceContext(db,args);if(basis.kind!=="basis")throw new Error(basis.reason);
 const row=basis.row;
 const policy=discoveryPolicyForNewSearch((await runModelPolicy(db,args.runId)).id);
 if(!row.search_intent_id||!["read","checked"].includes(row.state))throw new Error("challenge_has_no_executed_search");
 const search=(await db.query(`SELECT s.result,s.request_digest,(s.result->'receipt'=i.receipt AND i.run_id=s.run_id AND i.request_digest=s.request_digest) AS valid
 FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.intent_id=$1 AND s.account_id=$2 AND s.run_id=$3 AND s.task_id=$4 AND s.brief_revision=$5 AND s.policy_id=$6`,[row.search_intent_id,args.accountId,args.runId,row.task_id,args.briefRevision,policy.id])).rows[0];
 const query=counterevidenceSearch(basis.context.question,CounterevidenceActionSchema.parse(row.action).questionKeys);
 if(!query)throw new Error("challenge_public_query_unavailable");
 const bodyDigest=publicSearchDigest(query.action.query,policy.id),requestDigest=createHash("sha256").update(JSON.stringify({bodyDigest,policy:policy.id,briefRevision:args.briefRevision})).digest("hex");
 const searched=SearchResultSchema.safeParse(search?.result);
 if(!search?.valid||search.request_digest!==requestDigest||!searched.success||searched.data.receipt.requestDigest!==bodyDigest||searched.data.receipt.state!=="confirmed"||searched.data.receipt.actualMicro===undefined||searched.data.receipt.route!==`openrouter:${policy.model}:${policy.id}`)throw new Error("challenge_search_receipt_unavailable");
 const reads=z.array(z.object({operationId:z.string().uuid(),sourceVersionId:z.string().uuid(),readable:z.boolean()}).strict()).min(1).max(3).parse(row.read_operations);
 if(!reads.some(r=>r.readable))throw new Error("challenge_readable_evidence_unavailable");
 const readLocators:string[]=[];
 for(const read of reads){const saved=(await db.query(`SELECT o.locator,v.access_level FROM source_read_operations o JOIN source_versions v ON v.id=o.source_version_id
 JOIN extraction_receipts e ON e.source_version_id=v.id WHERE o.id=$1 AND o.account_id=$2 AND o.run_id=$3 AND o.brief_revision=$5 AND o.state='finished'
 AND o.source_version_id=$4 AND v.account_id=$2 AND e.account_id=$2 AND e.run_id=$3 AND e.transport->>'requestedUrl'=o.locator`,[read.operationId,args.accountId,args.runId,read.sourceVersionId,args.briefRevision])).rows[0];
 if(!saved||read.readable!==(saved.access_level==="partial-text"||saved.access_level==="full-text")||!searched.data.hits.some(h=>h.locator===saved.locator))throw new Error("challenge_read_proof_unavailable");readLocators.push(saved.locator);}
 if(searched.data.hits.some(h=>!readLocators.includes(h.locator)))throw new Error("challenge_uninspected_search_result");
 const model=(await db.query(`SELECT request_digest FROM model_operation_results WHERE intent_id=$1 AND account_id=$2 AND run_id=$3
 AND brief_revision=$4 AND evidence_revision=$5 AND operation='assess_support' AND schema_version=$6 AND prompt_version=$7 AND policy_id=$8`,
 [args.modelIntentId,args.accountId,args.runId,args.briefRevision,basis.evidenceRevision,RESEARCH_MODEL_SCHEMA_VERSION,MODEL_PROMPT_VERSION,versions.policyId])).rows[0];
 if(!model)throw new Error("challenge_support_execution_unavailable");
 const raw=await loadModelOperation(db,args.modelIntentId,args.runId,args.accountId,model.request_digest,basis.context);
 const parsed=z.object({status:z.literal("succeeded"),output:ResearchModelOutputs.assess_support,receipt:ModelReceiptSchema}).strict().parse(raw);
 if(parsed.receipt.actualMicro===null)throw new Error("challenge_support_receipt_unknown");
 const checks=resolveScopedSupport({assertions:basis.context.assertions,passages:basis.context.passages,proposal:parsed.output});
 const outcome=counterevidenceOutcome(checks),manifest=modelInputManifest(basis.context),evidenceDigest=counterevidenceDigest(manifest.passages);
 if(requireStored){if(row.state!=="checked"||row.model_intent_id!==args.modelIntentId||row.outcome!==outcome||row.evidence_revision!==basis.evidenceRevision||row.evidence_digest!==evidenceDigest||
  row.checker_version!==SCOPED_SUPPORT_VERSION||counterevidenceDigest(row.context_manifest)!==counterevidenceDigest(manifest)||counterevidenceDigest(row.result)!==counterevidenceDigest(checks))throw new Error("stored_challenge_result_mismatch");}
 else await db.query(`UPDATE counterevidence_checks SET state='checked',outcome=$2,reason=NULL,evidence_revision=$3,evidence_digest=$4,model_intent_id=$5,context_manifest=$6,result=$7,checker_version=$8 WHERE id=$1`,
 [row.id,outcome,basis.evidenceRevision,evidenceDigest,args.modelIntentId,JSON.stringify(manifest),JSON.stringify(checks),SCOPED_SUPPORT_VERSION]);
 return {outcome,checks,targets:basis.targets,evidenceRevision:basis.evidenceRevision};
}
/** Loss of the derived record cannot remove the admitted proof obligation. */
export async function requiredCounterevidenceMissing(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}) {
 const required=await db.query(`SELECT 1 FROM runs r WHERE r.id=$1 AND r.account_id=$2 AND
  (r.counterevidence_required_revision=$3 OR EXISTS(SELECT 1 FROM run_events e WHERE e.run_id=r.id AND e.account_id=$2 AND e.type='counterevidence_checked'))
  AND NOT EXISTS(SELECT 1 FROM counterevidence_checks c WHERE c.run_id=r.id AND c.account_id=$2 AND c.brief_revision=$3)`,[args.runId,args.accountId,args.briefRevision]);
 return Boolean(required.rowCount);
}
const unrestorableChallengeLimitation="The required counterevidence check cannot be restored. Its conclusions remain unresolved.";
/** Publication independently restores proof. Missing/blocked/unknown challenge can never improve support. */
export async function counterevidenceLimitations(db:Queryable,args:{runId:string;accountId:string;briefRevision:number}) {
 let row:SavedCounterevidence|null;
 try {row=await getCounterevidence(db,args);}
 catch(error){
  if(error instanceof Error&&(error.message==="challenge_proof_unreadable"||error.message==="unsupported_challenge_version"))
   return [unrestorableChallengeLimitation];
  throw error;
 }
 if(!row){
  return await requiredCounterevidenceMissing(db,args)?[unrestorableChallengeLimitation]:[];
 }
 const targets=await validateTargets(db,row);
 if(row.state!=="checked")return targets.map(t=>`Counterevidence search for “${t.assertion.text}” remains unresolved (${row.reason??"check_incomplete"}).`);
 const run=await getRun(db,args.runId);if(!run||row.evidence_revision!==run.evidence_revision)return targets.map(t=>`Counterevidence check for “${t.assertion.text}” is stale after evidence changed.`);
 if(!row.model_intent_id)throw new Error("challenge_support_execution_unavailable");
 const restored=await persistCounterevidenceResult(db,{...args,modelIntentId:row.model_intent_id},true);
 CounterevidenceOutcomeSchema.parse(restored.outcome);
 return restored.checks.filter(c=>c.decision!=="supported").map(c=>`Counterevidence check for “${targets.find(t=>t.assertion.key===c.claimKey)!.assertion.text}”: ${c.decision}. This conclusion remains unresolved.`);
}
