import { ScopeComparisonContextSchema,SCOPE_COMPARISON_CONTEXT_VERSION,CompareScopesActionSchema,ScopeComparisonResultSchema,SCOPE_COMPARISON_VERSION,type ResearchModelOutput,type ScopeComparisonResult } from "@deep/contracts";
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
const fields=["entity","plan","version","geography","time","population"] as const;
// Preserve case, dates and version spelling: aliases need evidence, not normalization guesses.
const normalize=(value:string)=>value.trim().replace(/\s+/gu," ");
/** Compare only overlapping criteria; absent scope is unknown, never a wildcard. */
export function compareAssertionScopes(action:unknown,assertions:Assertion[]):ScopeComparisonResult {
 const request=CompareScopesActionSchema.parse(action);
 const selected=request.claimKeys.map(key=>{
  const matches=assertions.filter(a=>a.key===key);if(matches.length!==1)throw new Error("comparison_target_unavailable");return matches[0]!;
 }).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const pairs:ScopeComparisonResult["pairs"]=[];let excludedUnrelatedPairs=0;
 for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++) {
  const left=selected[i]!,right=selected[j]!;
  const criterionKeys=[...new Set(left.criterionKeys.filter(key=>right.criterionKeys.includes(key)))].sort();
  if(!criterionKeys.length){excludedUnrelatedPairs++;continue;}
  const comparison=fields.map(field=>({field,left:left.scope[field],right:right.scope[field],relation:
   !left.scope[field]?.trim()||!right.scope[field]?.trim()?"unknown" as const:
   normalize(left.scope[field]!)===normalize(right.scope[field]!)?"equal" as const:"different" as const}));
  pairs.push({leftKey:left.key,rightKey:right.key,criterionKeys,fields:comparison,
   status:comparison.some(f=>f.relation==="different")?"different_scope":comparison.some(f=>f.relation==="unknown")?"scope_incomplete":"scope_matches",quantityCompatibility:"not_assessed",entailment:"not_assessed"});
 }
 return ScopeComparisonResultSchema.parse({version:SCOPE_COMPARISON_VERSION,pairs,excludedUnrelatedPairs});
}

/** Lossless relative to the supplied assertion scopes/criteria; no pair or qualification is dropped. */
export function projectScopeComparison(result:ScopeComparisonResult,assertions:Assertion[]) {
 const claimKeys=assertions.map(a=>a.key).sort();
 const expected=compareAssertionScopes({type:"compare_scopes",claimKeys},assertions);
 if(JSON.stringify(ScopeComparisonResultSchema.parse(result))!==JSON.stringify(expected))throw new Error("scope_projection_basis_mismatch");
 const grouped=new Map<string,{relations:ScopeComparisonResult["pairs"][number]["fields"][number]["relation"][];pairs:number[][]}>();
 for(const pair of expected.pairs) {
  const relations=pair.fields.map(f=>f.relation),key=relations.join("|");
  const group=grouped.get(key)??{relations,pairs:[]};
  group.pairs.push([claimKeys.indexOf(pair.leftKey),claimKeys.indexOf(pair.rightKey)]);grouped.set(key,group);
 }
 return ScopeComparisonContextSchema.parse({version:SCOPE_COMPARISON_CONTEXT_VERSION,pairEncoding:"zero_based_claimKeys_indices",criterionBinding:"shared_assertion_criterionKeys",scopeFields:fields,claimKeys,
  groups:[...grouped].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,value])=>value),
  excludedUnrelatedPairs:expected.excludedUnrelatedPairs,quantityCompatibility:"not_assessed",entailment:"not_assessed"});
}
