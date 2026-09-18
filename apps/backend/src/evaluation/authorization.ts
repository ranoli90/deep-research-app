import { createHash } from "node:crypto";
import { z } from "zod";
export const sha256=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const hex=z.string().regex(/^[a-f0-9]{64}$/);
export const HeldIntentContinuationSchema=z.object({version:z.literal("held-intent-continuation.v1"),intents:z.array(z.object({
 intentId:z.string().uuid(),runId:z.string().uuid(),requestDigest:hex,receiptDigest:hex,questionDigest:hex,
 reservedMicro:z.number().int().positive().safe(),policyId:z.string().min(1).max(100)
}).strict()).min(1).max(8)}).strict();
export const evaluationQuestionDigest=(question:string)=>sha256(question.normalize("NFC").trim().replace(/\s+/gu," ").toLowerCase());
export const AuthorizationSchema=z.object({version:z.literal("matched-evaluation-authorization.v1"),approvalId:z.string().uuid(),approvalReference:z.string().regex(/^[a-zA-Z0-9._:-]{1,160}$/),issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),protocolSha256:hex,freezeSha256:hex,taskIds:z.array(z.string().regex(/^MC-[DH]\d{2}$/)).min(1).max(12),budgetMicro:z.number().int().positive().safe(),accountId:z.string().uuid(),budgetScope:z.string().regex(/^evaluation:[a-zA-Z0-9_-]{1,100}$/),sourceMode:z.enum(["live_discovery","frozen_supplied_document"]),exclusiveDatabaseAcknowledged:z.literal(true),heldIntentContinuation:HeldIntentContinuationSchema.optional()}).strict();
export type Authorization=z.infer<typeof AuthorizationSchema>;
export type FrozenSource={id:string;file:string;mime:string;sha256:string};
export type TaskProjection={id:string;question:string;correctedQuestion:string;index:number;repetitions:number;sources?:FrozenSource[];unavailableReason?:string};
export type RegisteredPlan={authorization:Authorization;tasks:TaskProjection[];registeredTaskIds:string[];unselectedTaskIds:string[];protocolHash:string;freezeHash:string;tasksHash:string;sourcesHash:string};
export function authorize(raw:string,flags:{execute:boolean;operatorConfirmsUserApproval:boolean;approvalId:string;sha256:string},now=Date.now()):Authorization {
 if(!flags.execute||!flags.operatorConfirmsUserApproval||sha256(raw)!==flags.sha256)throw new Error("explicit_current_approval_required");
 const grant=AuthorizationSchema.parse(JSON.parse(raw));
 if(grant.approvalId!==flags.approvalId||Date.parse(grant.issuedAt)>now||Date.parse(grant.expiresAt)<=now||Date.parse(grant.expiresAt)-Date.parse(grant.issuedAt)>86400000)throw new Error("approval_expired_or_mismatched");
 if(new Set(grant.taskIds).size!==grant.taskIds.length)throw new Error("duplicate_task_scope");
 if(grant.heldIntentContinuation&&new Set(grant.heldIntentContinuation.intents.map(i=>i.intentId)).size!==grant.heldIntentContinuation.intents.length)throw new Error("duplicate_held_intent");
 return grant;
}
/** Evaluator labels stay in this loader: only question strings enter the execution projection. */
export function registeredPlan(grant:Authorization,files:{protocol:string;freeze:string;tasks:string;sources:string}):RegisteredPlan {
 const protocol=JSON.parse(files.protocol),freeze=JSON.parse(files.freeze),catalog=JSON.parse(files.tasks);
 if(sha256(files.protocol)!==grant.protocolSha256||sha256(files.freeze)!==grant.freezeSha256||sha256(files.tasks)!==freeze.tasksSha256||sha256(files.sources)!==freeze.sourcesSha256)throw new Error("registration_hash_mismatch");
 if(protocol.version!=="matched-real-model-protocol.v1"||protocol.arms?.A1!=="iterative-baseline.v1"||protocol.arms?.B!=="criterion-adaptive.v1"||protocol.repetitions?.allTasks!==1||!Array.isArray(protocol.repetitions?.selectedThreeRepeats)||!Array.isArray(catalog.tasks))throw new Error("unsupported_registered_protocol");
 if(grant.heldIntentContinuation&&protocol.heldIntentContinuation!=="held-intent-continuation.v1")throw new Error("continuation_not_registered");
 const tasks:TaskProjection[]=catalog.tasks.map((t:unknown,index:number)=>{const v=z.object({id:z.string(),question:z.string().min(1).max(20000),correctedQuestion:z.string().min(1).max(20000)}).parse(t);const task:TaskProjection={...v,index,repetitions:protocol.repetitions.selectedThreeRepeats.includes(v.id)?3:1};
 if(grant.sourceMode==="frozen_supplied_document"){
  const ids=z.object({sourceIds:z.array(z.string()).min(1).max(3)}).safeParse(t);
  const sourceCatalog=JSON.parse(files.sources);
  if(!ids.success||new Set(ids.data.sourceIds).size!==ids.data.sourceIds.length){task.unavailableReason="frozen_sources_unregistered";return task;}
  task.sources=ids.data.sourceIds.map(id=>{
   const source=z.object({id:z.string(),file:z.string().regex(/^[a-zA-Z0-9._-]+$/),mime:z.string()}).parse(sourceCatalog.sources?.find((s:{id:string})=>s.id===id));
   const pin=z.object({sha256:hex}).parse(freeze.documents?.find((s:{id:string})=>s.id===id));
   return {...source,sha256:pin.sha256};
  });
  if(task.sources.some(s=>!["application/pdf","text/html"].includes(s.mime)))task.unavailableReason="frozen_source_mime_unsupported";
 }
 return task;});
 if(grant.heldIntentContinuation&&tasks.filter(t=>grant.taskIds.includes(t.id)).some(t=>[t.question,t.correctedQuestion].some(q=>grant.heldIntentContinuation!.intents.some(i=>i.questionDigest===evaluationQuestionDigest(q)))))throw new Error("unknown_question_retry_forbidden");
 if(grant.taskIds.some(id=>!tasks.some(t=>t.id===id)))throw new Error("unregistered_task");
 return {authorization:grant,tasks:tasks.filter(t=>grant.taskIds.includes(t.id)),registeredTaskIds:tasks.map(t=>t.id),unselectedTaskIds:tasks.filter(t=>!grant.taskIds.includes(t.id)).map(t=>t.id),protocolHash:sha256(files.protocol),freezeHash:sha256(files.freeze),tasksHash:sha256(files.tasks),sourcesHash:sha256(files.sources)};
}
