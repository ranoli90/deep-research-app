import type { ResearchModelOutput } from "@deep/contracts";

export const DISCOVERY_PLANNER_VERSION="criterion-discovery.v1";
/** Simple-task / same-criterion planner ceiling. Deep adaptive breadth uses DEEP_DISCOVERY_CEILING. */
export const MAX_DISCOVERY_QUERIES=3;
export const DEEP_DISCOVERY_CEILING=10;
/** Narrow discovery to unmet criteria without copying any source text into public queries. */
export function nextCriterionSearch(args:{question:string;task:ResearchModelOutput<"brief">;unresolvedCriterionKeys:string[];queries:string[]}) {
 const normalize=(text:string)=>text.trim().toLocaleLowerCase("en").replace(/\s+/gu," ");
 const seen=new Set(args.queries.map(normalize));
 if(seen.size>=MAX_DISCOVERY_QUERIES)return {kind:"stop" as const,reason:"discovery_query_limit"};
 for(const criterion of args.task.criteria) {
  if(!args.unresolvedCriterionKeys.includes(criterion.key))continue;
  const basis=criterion.provenance,query=basis.quote.trim();
  if(basis.start<0||basis.end<=basis.start||args.question.slice(basis.start,basis.end)!==basis.quote)throw new Error("invalid_discovery_provenance");
  if(!query||query.length>4000||seen.has(normalize(query)))continue;
  const questionKeys=args.task.questions.filter((q)=>q.criterionKeys.includes(criterion.key)).map((q)=>q.key);
  if(!questionKeys.length||questionKeys.length>12)continue;
  return {kind:"search" as const,proposal:{rationale:"Investigate an unresolved criterion using its original question wording.",action:{type:"search" as const,query,questionKeys,publicQueryBasis:basis}}};
 }
 return {kind:"stop" as const,reason:"no_distinct_public_criterion_query"};
}
