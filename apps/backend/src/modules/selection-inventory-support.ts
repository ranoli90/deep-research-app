import {resolveScopedSupport,SCOPED_SUPPORT_VERSION} from "@deep/research-core";
import type {Queryable} from "../platform/db.js";
import type {ModelContext} from "../ports/model.js";
import type {CheckedAssertion,SupportArgs} from "./scoped-support.js";
import {restoreEvidenceSelection,evidenceSelectionDigest,EvidenceSelectionProofError} from "./evidence-selections.js";
export const SELECTION_INVENTORY_CHECKER_VERSION="selection-inventory.v1";
/** A model's bounded context cannot hide a known literal contradiction or qualification.
 * This is an additional deterministic gate, not semantic comprehension of every passage.
 */
export async function applySelectionInventorySupport(db:Queryable,args:SupportArgs&{
 modelIntentId:string;evidenceRevision:number;context:ModelContext;checked:CheckedAssertion[];
},requireStored:boolean):Promise<CheckedAssertion[]> {
 if(!args.context.evidenceSelection)return args.checked;
 const inventory=await restoreEvidenceSelection(db,{...args,selectionId:args.context.evidenceSelection.id});
 if(inventory.evidenceRevision!==args.evidenceRevision)throw new EvidenceSelectionProofError("selection_inventory_revision_changed");
 const proposal={assessments:args.checked.map(c=>({claimKey:c.claimKey,status:c.modelStatus,scope:c.scope,evidence:c.evidence,rationale:c.rationale,missingEvidence:c.missingEvidence}))};
 const checked=resolveScopedSupport({assertions:args.context.assertions,passages:inventory.inventoryPassages,proposal});
 const effective:CheckedAssertion[]=[];
 for(const original of args.checked){
  const result=checked.find(c=>c.claimKey===original.claimKey)!;
  const assertion=args.context.assertions.find(c=>c.key===original.claimKey)!;
  const scopeDigest=evidenceSelectionDigest(assertion.scope),inputDigest=evidenceSelectionDigest({
   version:SELECTION_INVENTORY_CHECKER_VERSION,underlyingChecker:SCOPED_SUPPORT_VERSION,
   claimRevisionId:original.claimRevisionId,assertion,selectedSupport:original,
   selectionId:inventory.context.id,selectionProofDigest:inventory.context.proofDigest,supportIntentId:args.modelIntentId,
  });
  const values=[args.accountId,args.runId,inventory.context.id,original.claimRevisionId,args.modelIntentId,
   SELECTION_INVENTORY_CHECKER_VERSION,inputDigest,scopeDigest,inventory.context.proofDigest,result.decision,JSON.stringify(result)];
  if(!requireStored)await db.query(`INSERT INTO selection_inventory_checks(account_id,run_id,selection_id,claim_revision_id,support_intent_id,checker_version,input_digest,scope_digest,evidence_digest,decision,result)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,values);
  const saved=(await db.query(`SELECT (account_id=$1 AND run_id=$2 AND input_digest=$7 AND scope_digest=$8 AND evidence_digest=$9 AND decision=$10 AND result=$11::jsonb) AS valid
   FROM selection_inventory_checks WHERE selection_id=$3 AND claim_revision_id=$4 AND support_intent_id=$5 AND checker_version=$6`,values)).rows[0];
  // Old admitted results may predate this additive gate. Read-only restoration still
  // executes the full check; it never writes a new record outside worker fencing.
  if(saved&&!saved.valid||!requireStored&&!saved)throw new EvidenceSelectionProofError("selection_inventory_check_changed");
  // Never promote an earlier negative or uncertain decision with a different input set.
  effective.push(original.decision==="supported"&&result.decision!=="supported"?{...original,...result}:original);
 }
 return effective;
}
