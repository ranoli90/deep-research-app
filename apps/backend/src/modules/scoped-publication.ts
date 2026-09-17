import { SCOPED_SUPPORT_VERSION, type StoredClaim } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { MODEL_PROMPT_VERSION, STRUCTURED_MODEL_POLICY } from "../ports/model-policy.js";
import { loadSupportContext, persistScopedSupport } from "./scoped-support.js";

/** Publication re-executes stored checks against current owned data. Caller prose is not authority. */
export async function scopedPublicationClaims(db:Queryable,args:{runId:string;accountId:string;briefRevision:number;evidenceRevision:number;claims:StoredClaim[]}) {
  const ids=args.claims.map((c)=>c.id);
  const managed=(await db.query<{claim_id:string;account_id:string;run_id:string}>(
    "SELECT claim_id,account_id,run_id FROM extracted_assertions WHERE claim_id::text=ANY($1::text[])",[ids])).rows;
  const managedIds=new Set(managed.map((c)=>c.claim_id));
  const approved=new Map<string,{claimId:string;text:string;passageIds:string[]}>();
  const rejected=new Set<string>();
  for(const row of managed) if(row.account_id!==args.accountId||row.run_id!==args.runId) rejected.add(row.claim_id);
  const operations=(await db.query<{model_intent_id:string;extraction_intent_id:string;task_id:string}>(`SELECT DISTINCT s.model_intent_id,s.extraction_intent_id,s.task_id
    FROM scoped_support_results s JOIN extracted_assertions e ON e.claim_revision_id=s.claim_revision_id
    WHERE e.claim_id::text=ANY($1::text[]) AND s.account_id=$2 AND s.run_id=$3 AND s.brief_revision=$4
      AND s.evidence_revision=$5 AND s.checker_version=$6`,
    [ids,args.accountId,args.runId,args.briefRevision,args.evidenceRevision,SCOPED_SUPPORT_VERSION])).rows;
  const versions={promptVersion:MODEL_PROMPT_VERSION,policyId:STRUCTURED_MODEL_POLICY.id};
  for(const operation of operations) {
    const basisArgs={...args,taskId:operation.task_id,extractionIntentId:operation.extraction_intent_id};
    const basis=await loadSupportContext(db,basisArgs,versions);
    if(basis.evidenceRevision!==args.evidenceRevision) throw new Error("stale_publication_support");
    const checked=await persistScopedSupport(db,{...basisArgs,...basis,modelIntentId:operation.model_intent_id},versions,true);
    for(const item of checked) {
      const supplied=args.claims.find((c)=>c.id===item.claimId);
      if(!supplied) continue;
      const canonical=basis.context.assertions.find((c)=>c.key===item.claimKey)!;
      const passageIds=[...new Set(item.evidence.map((e)=>e.passageId))].sort();
      if(item.decision!=="supported" || supplied.text!==canonical.text || supplied.derivation ||
        JSON.stringify([...new Set(supplied.passageIds)].sort())!==JSON.stringify(passageIds)) rejected.add(item.claimId);
      else approved.set(item.claimId,{claimId:item.claimId,text:canonical.text,passageIds});
    }
  }
  // Any negative/current check wins over another positive. Managed assertions cannot fall back to literal approval.
  for(const id of managedIds) if(!approved.has(id)) rejected.add(id);
  for(const id of rejected) approved.delete(id);
  return {approved,rejected,managedIds};
}
