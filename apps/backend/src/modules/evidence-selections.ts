import {createHash} from "node:crypto";
import {z} from "zod";
import {selectWholePassages,EVIDENCE_SELECTION_VERSION,EVIDENCE_SELECTION_LIMITS,type SelectionPassage} from "@deep/research-core";
import type {Queryable} from "../platform/db.js";
import {EvidenceSelectionContextSchema,type EvidenceSelectionContext} from "../ports/evidence-selection.js";
import {getBrief,getRun} from "./runs.js";
export class EvidenceSelectionProofError extends Error {}
const parseProof=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new EvidenceSelectionProofError("selection_proof_invalid");return parsed.data;};
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
export const evidenceSelectionDigest=(v:unknown)=>createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const digest=evidenceSelectionDigest;
const idsSchema=z.array(z.string().uuid()).max(4096).refine(ids=>new Set(ids).size===ids.length);
const metadata=(ps:SelectionPassage[])=>ps.map(({text:_,...p})=>p).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
type Args={accountId:string;runId:string;briefRevision:number};
export async function usesEvidenceSelection(db:Queryable,args:Args):Promise<boolean> {
 const row=(await db.query("SELECT evidence_selection_policy FROM runs WHERE id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision])).rows[0];
 if(row?.evidence_selection_policy==="legacy-all.v1")return false;
 if(row?.evidence_selection_policy===EVIDENCE_SELECTION_VERSION)return true;
 throw new EvidenceSelectionProofError("selection_policy_unavailable");
}
async function ownedQuestion(db:Queryable,args:Args) {
 const run=await getRun(db,args.runId);if(!run||run.account_id!==args.accountId||run.brief_revision!==args.briefRevision)throw new EvidenceSelectionProofError("selection_owner_or_revision_mismatch");
 const brief=await getBrief(db,run.brief_id);if(!brief)throw new EvidenceSelectionProofError("selection_brief_unavailable");return {run,question:brief.originalQuestion};
}
async function candidates(db:Queryable,args:Args,ids?:string[]):Promise<SelectionPassage[]> {
 const rows=await db.query<{id:string;version:string;source:string;digest:string;text:string;access:string;title:string;locator:unknown}>(`SELECT p.id,p.source_version_id AS version,s.id AS source,p.content_hash AS digest,p.exact_text AS text,
 v.access_level AS access,s.title,p.locator FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
 WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND s.account_id=$1 AND v.access_level IN ('partial-text','full-text')
 AND ($3::uuid[] IS NULL OR p.id=ANY($3::uuid[])) ORDER BY p.id LIMIT $4`,[args.accountId,args.runId,ids??null,EVIDENCE_SELECTION_LIMITS.candidates+1]);
 return rows.rows.map(p=>({id:p.id,sourceVersionId:p.version,sourceId:p.source,digest:p.digest,text:p.text,accessLevel:p.access,title:p.title,locator:typeof (p.locator as {block?:unknown})?.block==="string"?(p.locator as {block:string}).block:"",locatorDigest:digest(p.locator)}));
}
/** Restore a fixed inventory, including omitted metadata, without adopting evidence added later. */
export async function restoreEvidenceSelection(db:Queryable,args:Args&{selectionId:string}) {
 const {run,question}=await ownedQuestion(db,args);
 const row=(await db.query("SELECT * FROM evidence_selections WHERE id=$1 AND account_id=$2 AND run_id=$3 AND brief_revision=$4",[args.selectionId,args.accountId,args.runId,args.briefRevision])).rows[0];
 if(!row||row.version!==EVIDENCE_SELECTION_VERSION||row.evidence_revision>run.evidence_revision||row.question_digest!==digest(question))throw new EvidenceSelectionProofError("selection_proof_unavailable");
 const ids=parseProof(idsSchema,parseProof(z.array(z.object({id:z.string().uuid()})),row.candidates).map(p=>p.id));
 if(row.evidence_revision===run.evidence_revision){const current=await db.query(`SELECT count(*)::int AS n FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id
 WHERE p.account_id=$1 AND p.run_id=$2 AND v.account_id=$1 AND s.account_id=$1 AND v.access_level IN ('partial-text','full-text')`,[args.accountId,args.runId]);
 if(current.rows[0].n!==ids.length)throw new EvidenceSelectionProofError("selection_inventory_changed_without_revision");}
 const ps=await candidates(db,args,ids),required=parseProof(idsSchema,row.required_ids);
 if(ps.length!==ids.length||digest(metadata(ps))!==digest(row.candidates)||required.join()!==[...required].sort().join()||digest(required)!==row.required_digest||ps.some(p=>createHash("sha256").update(p.text).digest("hex")!==p.digest))throw new EvidenceSelectionProofError("selection_evidence_changed");
 const result=selectWholePassages(question,ps,required);
 if(result.kind!=="selected"||digest(result)!==digest(row.selection))throw new EvidenceSelectionProofError("selection_result_changed");
 const proofDigest=digest({version:row.version,questionDigest:row.question_digest,evidenceRevision:row.evidence_revision,required,candidates:metadata(ps),selection:result});
 if(proofDigest!==row.proof_digest)throw new EvidenceSelectionProofError("selection_proof_changed");
 const context=EvidenceSelectionContextSchema.parse({id:row.id,version:row.version,proofDigest,available:result.available,selected:result.passageIds.length,omitted:result.omitted});
 return {context,passageIds:result.passageIds,evidenceRevision:row.evidence_revision,inventoryPassages:ps};
}
/** Call only within a fenced worker transaction; no network or model authority. */
export async function prepareEvidenceSelection(db:Queryable,args:Args&{requiredIds?:string[]}) {
 if(!await usesEvidenceSelection(db,args))throw new EvidenceSelectionProofError("selection_policy_unavailable");
 const {run,question}=await ownedQuestion(db,args),required=idsSchema.parse([...new Set(args.requiredIds??[])].sort()),requiredDigest=digest(required);
 const slot={evidenceRevision:run.evidence_revision,requiredDigest,version:EVIDENCE_SELECTION_VERSION};
 const obligations=parseProof(z.array(z.object({id:z.string().uuid(),evidenceRevision:z.number().int(),requiredDigest:z.string(),version:z.string()}).strict()),(await db.query("SELECT evidence_selection_obligations FROM runs WHERE id=$1 AND account_id=$2",[args.runId,args.accountId])).rows[0]?.evidence_selection_obligations);
 const obligation=obligations.find(o=>o.evidenceRevision===slot.evidenceRevision&&o.requiredDigest===slot.requiredDigest&&o.version===slot.version);
 const prior=(await db.query("SELECT id FROM evidence_selections WHERE account_id=$1 AND run_id=$2 AND brief_revision=$3 AND evidence_revision=$4 AND version=$5 AND required_digest=$6",[args.accountId,args.runId,args.briefRevision,run.evidence_revision,EVIDENCE_SELECTION_VERSION,requiredDigest])).rows[0];
 if(Boolean(prior)!==Boolean(obligation)||prior&&prior.id!==obligation?.id)throw new EvidenceSelectionProofError("required_selection_proof_missing");
 if(prior)return {kind:"selected" as const,...await restoreEvidenceSelection(db,{...args,selectionId:prior.id})};
 const ps=await candidates(db,args),result=selectWholePassages(question,ps,required);if(result.kind==="blocked")return result;
 const questionDigest=digest(question),basis=metadata(ps),proofDigest=digest({version:EVIDENCE_SELECTION_VERSION,questionDigest,evidenceRevision:run.evidence_revision,required,candidates:basis,selection:result});
 const id=crypto.randomUUID();
 await db.query(`INSERT INTO evidence_selections(id,account_id,run_id,brief_revision,evidence_revision,version,question_digest,required_ids,required_digest,candidates,selection,proof_digest)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,args.accountId,args.runId,args.briefRevision,run.evidence_revision,EVIDENCE_SELECTION_VERSION,questionDigest,JSON.stringify(required),requiredDigest,JSON.stringify(basis),JSON.stringify(result),proofDigest]);
 await db.query("UPDATE runs SET evidence_selection_required_revision=$3,evidence_selection_obligations=evidence_selection_obligations||$4::jsonb WHERE id=$1 AND account_id=$2 AND brief_revision=$3",[args.runId,args.accountId,args.briefRevision,JSON.stringify([{...slot,id}])]);
 return {kind:"selected" as const,...await restoreEvidenceSelection(db,{...args,selectionId:id})};
}
export async function validateSelectionContext(db:Queryable,args:Args&{evidenceRevision:number;selection:EvidenceSelectionContext;passageIds:string[];historical?:boolean}) {
 const restored=await restoreEvidenceSelection(db,{...args,selectionId:args.selection.id});
 if(digest(restored.context)!==digest(args.selection)||digest(restored.passageIds)!==digest([...args.passageIds].sort()))throw new EvidenceSelectionProofError("selection_context_mismatch");
 if(args.historical){if(restored.evidenceRevision>args.evidenceRevision)throw new EvidenceSelectionProofError("selection_context_mismatch");return;}
 if(restored.evidenceRevision!==args.evidenceRevision)throw new EvidenceSelectionProofError("selection_context_mismatch");
}
/** Publication replays the report's selection snapshot; no outcome flag can erase omissions or proof loss. */
export async function evidenceSelectionLimitations(db:Queryable,args:Args&{evidenceRevision?:number}) {
 const marker=(await db.query("SELECT evidence_selection_required_revision,evidence_selection_obligations,evidence_revision FROM runs WHERE id=$1 AND account_id=$2",[args.runId,args.accountId])).rows[0];
 if(!marker)throw new EvidenceSelectionProofError("selection_owner_or_revision_mismatch");
 if(marker.evidence_selection_required_revision!==args.briefRevision){
  const proof=await db.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM evidence_selections WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3)
   OR EXISTS(SELECT 1 FROM model_operation_results WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3 AND input_manifest ? 'evidenceSelection')`,[args.runId,args.accountId,args.briefRevision]);
  if(proof.rowCount)throw new EvidenceSelectionProofError("selection_obligation_missing");return [];
 }
 const evidenceRevision=args.evidenceRevision??marker.evidence_revision;
 if(evidenceRevision>marker.evidence_revision)throw new EvidenceSelectionProofError("selection_owner_or_revision_mismatch");
 const rows=(await db.query("SELECT id FROM evidence_selections WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3 AND evidence_revision=$4 ORDER BY id",[args.runId,args.accountId,args.briefRevision,evidenceRevision])).rows;
 const obligations=parseProof(z.array(z.object({id:z.string().uuid(),evidenceRevision:z.number().int()})),marker.evidence_selection_obligations).filter(o=>o.evidenceRevision===evidenceRevision);
 if(rows.length!==obligations.length||obligations.some(o=>!rows.some(r=>r.id===o.id)))throw new EvidenceSelectionProofError("required_selection_proof_missing");
 if(!rows.length)throw new EvidenceSelectionProofError("required_selection_proof_missing");
 const limitations=new Set<string>();
 for(const row of rows){const restored=await restoreEvidenceSelection(db,{...args,selectionId:row.id});const s=restored.context;
  if(s.omitted)limitations.add(`This assessment selected ${s.selected} of ${s.available} available passages. The ${s.omitted} omitted passages were not included in the model assessment; additional qualifications or counterevidence may remain.`);
 }return [...limitations].sort();
}
