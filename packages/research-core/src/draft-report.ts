import type { ReportBlock } from "@deep/contracts";
import { UNRESOLVED_SECTION } from "./citations.js";
import type { DraftStatement } from "./draft-assertions.js";
import type { ScopedSupportResult } from "./scoped-support.js";
import type { StoredClaim } from "./types.js";

/** Every final model-authored surface maps to its own checked assertion. */
export function compileCheckedDraft(statements:DraftStatement[],checks:(ScopedSupportResult&{claimId:string})[]) {
  const blocks:ReportBlock[]=[],claims:StoredClaim[]=[],unresolved:string[]=[];
  for(const statement of statements) {
    if(!statement.assertion) {blocks.push({id:statement.key,kind:statement.kind,text:statement.text,claimIds:[],citationIds:[]});continue;}
    const matching=checks.filter((c)=>c.claimKey===statement.key);
    if(matching.length!==1)throw new Error("missing_or_duplicate_writer_support");
    const check=matching[0]!;
    if(check.decision!=="supported") {
      if(statement.kind==="heading") {
        blocks.push({id:statement.key,kind:"heading",text:statement.text,claimIds:[],citationIds:[]});
        continue;
      }
      unresolved.push(statement.key);
      blocks.push({id:statement.key,kind:"caveat",text:UNRESOLVED_SECTION,claimIds:[],
        citationIds:[...new Set([...check.evidence.map((e)=>e.passageId),...check.counterEvidence.map((e)=>e.passageId)])]});
      continue;
    }
    const passageIds=[...new Set(check.evidence.map((e)=>e.passageId))];
    blocks.push({id:statement.key,kind:statement.kind,text:statement.text,claimIds:[check.claimId],citationIds:passageIds});
    claims.push({id:check.claimId,text:statement.text,type:"inference",supportStatus:"inference",passageIds});
  }
  return {blocks,claims,unresolved};
}
