import {runModelVersions} from "./run-model-policy.js";
import { createHash } from "node:crypto";
import { CALCULATION_REPORT_VERSION,calculationReportText,type StoredClaim } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { MODEL_PROMPT_VERSION } from "../ports/model-policy.js";
import { persistEvidenceCalculation } from "./evidence-calculations.js";
import { loadSupportContext } from "./scoped-support.js";
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
type Basis={accountId:string;runId:string;briefRevision:number;evidenceRevision:number};

/** Caller holds account/run fence. No stored result alone authorizes a report claim. */
export async function prepareCalculationClaim(db:Queryable,args:Basis&{calculationId:string},requireStored=false) {
 const versions=await runModelVersions(db,args.runId);
 const row=(await db.query(`SELECT * FROM evidence_calculations WHERE id=$1 AND account_id=$2 AND run_id=$3
  AND brief_revision=$4 AND evidence_revision=$5`,[args.calculationId,args.accountId,args.runId,args.briefRevision,args.evidenceRevision])).rows[0];
 if(!row)throw new Error("calculation_publication_basis_mismatch");
 const input={...args,taskId:row.task_id,extractionIntentId:row.extraction_intent_id,supportIntentId:row.support_intent_id,action:row.action};
 const checked=await persistEvidenceCalculation(db,input,versions,true);
 if(checked.kind!=="calculation"||checked.id!==row.id)throw new Error("calculation_proof_mismatch");
 if(checked.result.status!=="computed")return {kind:"blocked" as const,reason:"calculation_unresolved"};
 const basis=await loadSupportContext(db,input,versions);
 const text=calculationReportText(checked.result,checked.result.inputs.map(i=>basis.context.assertions.find(a=>a.key===i.claimKey)!.text))!;
 const passageIds=[...new Set(checked.result.inputs.flatMap(i=>i.evidence.map(e=>e.passageId)))].sort();
 const scope={briefRevision:args.briefRevision,evidenceRevision:args.evidenceRevision,calculationId:row.id,
  inputDigest:row.input_digest,inputClaimRevisionIds:row.claim_revision_ids,rendererVersion:CALCULATION_REPORT_VERSION,
  semanticScope:{kind:"arithmetic",formula:checked.result.formula,operands:checked.result.inputs.map(i=>basis.context.assertions.find(a=>a.key===i.claimKey)!.scope),assumptions:checked.result.assumptions},
  quantities:[checked.result.output]};
 const saved=(await db.query(`SELECT m.*,c.text,c.type,r.text AS revision_text,r.text_digest,r.scope,
  c.account_id AS claim_owner,c.run_id AS claim_run,r.account_id AS revision_owner,r.run_id AS revision_run,r.claim_id AS revision_claim
  FROM calculation_claims m JOIN claims c ON c.id=m.claim_id JOIN claim_revisions r ON r.id=m.claim_revision_id WHERE m.calculation_id=$1`,[row.id])).rows[0];
 if(saved) {
  if(saved.account_id!==args.accountId||saved.run_id!==args.runId||saved.claim_owner!==args.accountId||saved.claim_run!==args.runId||
   saved.revision_owner!==args.accountId||saved.revision_run!==args.runId||saved.revision_claim!==saved.claim_id||
   saved.renderer_version!==CALCULATION_REPORT_VERSION||saved.text!==text||saved.revision_text!==text||saved.text_digest!==digest(text)||saved.type!=="calculation"||
   stable(saved.scope)!==stable(scope))throw new Error("calculation_claim_mismatch");
  return {kind:"claim" as const,claim:{id:saved.claim_id as string,text,type:"calculation",supportStatus:"inference",passageIds} satisfies StoredClaim,revisionId:saved.claim_revision_id as string};
 }
 if(requireStored)throw new Error("missing_calculation_claim");
 const id=crypto.randomUUID(),revisionId=crypto.randomUUID();
 await db.query("INSERT INTO claims(id,run_id,account_id,text,type,support_status) VALUES($1,$2,$3,$4,'calculation','unverified')",[id,args.runId,args.accountId,text]);
 await db.query(`INSERT INTO claim_revisions(id,claim_id,account_id,run_id,revision,text,text_digest,scope) VALUES($1,$2,$3,$4,1,$5,$6,$7)`,[revisionId,id,args.accountId,args.runId,text,digest(text),JSON.stringify(scope)]);
 await db.query(`INSERT INTO calculation_claims(calculation_id,account_id,run_id,claim_id,claim_revision_id,renderer_version) VALUES($1,$2,$3,$4,$5,$6)`,[row.id,args.accountId,args.runId,id,revisionId,CALCULATION_REPORT_VERSION]);
 return {kind:"claim" as const,claim:{id,text,type:"calculation",supportStatus:"inference",passageIds} satisfies StoredClaim,revisionId};
}

export async function calculationPublicationClaims(db:Queryable,args:Basis&{claims:StoredClaim[]}) {
 const rows=(await db.query("SELECT calculation_id,claim_id,account_id,run_id FROM calculation_claims WHERE claim_id::text=ANY($1::text[])",[args.claims.map(c=>c.id)])).rows;
 const approved=new Map<string,{claimId:string;text:string;passageIds:string[]}>(),rejected=new Set<string>();
 for(const row of rows) {
  if(row.account_id!==args.accountId||row.run_id!==args.runId){rejected.add(row.claim_id);continue;}
  const restored=await prepareCalculationClaim(db,{...args,calculationId:row.calculation_id},true);
  const claim=args.claims.find(c=>c.id===row.claim_id)!;
  if(restored.kind!=="claim"||claim.derivation||claim.type!=="calculation"||claim.text!==restored.claim.text||
   JSON.stringify([...new Set(claim.passageIds)].sort())!==JSON.stringify(restored.claim.passageIds))rejected.add(claim.id);
  else approved.set(claim.id,{claimId:claim.id,text:claim.text,passageIds:restored.claim.passageIds});
 }
 return {approved,rejected};
}
