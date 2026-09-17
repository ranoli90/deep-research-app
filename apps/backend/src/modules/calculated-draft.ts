import { compileCheckedDraft,draftStatements,UNRESOLVED_SECTION } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import type { TaskModelVersions } from "./research-tasks.js";
import { loadSupportContext,persistScopedSupport,restoreWriterDraft,type SupportArgs } from "./scoped-support.js";

/** Assemble only checked ordinary prose and server-rendered arithmetic. No new numerical prose is trusted. */
export async function assembleCalculatedDraft(db:Queryable,args:SupportArgs&{supportIntentId:string},versions:TaskModelVersions) {
 const restored=await restoreWriterDraft(db,args,versions);
 const basis=await loadSupportContext(db,args,versions);
 const checks=await persistScopedSupport(db,{...args,...basis,modelIntentId:args.supportIntentId},versions,true);
 const compiled=compileCheckedDraft(draftStatements(restored.draft,restored.basis.context.assertions,restored.basis.context.approvedClaimKeys),checks);
 if(!restored.basis.context.calculations)throw new Error("calculated_draft_requires_plan");
 const calculations={...restored.basis.context.calculations,entries:restored.basis.context.calculations.entries.map(e=>({...e,selected:restored.calculationKeys.includes(e.key)}))};
 const selected=calculations.entries.filter(e=>e.selected);
 if(selected.length)compiled.blocks.push({id:"calculations",kind:"heading",text:"Calculations",claimIds:[],citationIds:[]});
 for(const [index,entry] of selected.entries()) {
  const id=`calculation_${index}`,passageIds=[...new Set(entry.result.inputs.flatMap(i=>i.evidence.map(e=>e.passageId)))].sort();
  if(entry.result.status!=="computed"||!entry.claimId||!entry.text) {
   compiled.blocks.push({id,kind:"caveat",text:UNRESOLVED_SECTION,claimIds:[],citationIds:passageIds});compiled.unresolved.push(id);continue;
  }
  compiled.blocks.push({id,kind:"text",text:entry.text,claimIds:[entry.claimId],citationIds:passageIds});
  compiled.claims.push({id:entry.claimId,text:entry.text,type:"calculation",supportStatus:"inference",passageIds});
 }
 return {...basis,checks,compiled,context:{...basis.context,approvedClaimKeys:checks.filter(c=>c.decision==="supported").map(c=>c.claimKey),calculations}};
}
