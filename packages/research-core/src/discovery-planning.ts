import type { ResearchModelOutput } from "@deep/contracts";

export const DISCOVERY_PLANNER_VERSION="criterion-discovery.v1";
/** Simple-task / same-criterion planner ceiling. Deep adaptive breadth uses DEEP_DISCOVERY_CEILING. */
export const MAX_DISCOVERY_QUERIES=3;
export const DEEP_DISCOVERY_CEILING=6;
const normalize=(text:string)=>text.trim().toLocaleLowerCase("en").replace(/\s+/gu," ");
type Criterion=ResearchModelOutput<"brief">["criteria"][number];
type Span={start:number;end:number;quote:string};

function findInQuestion(question:string,needle:string):Span|null {
 if(!needle.trim())return null;
 const i=question.toLocaleLowerCase("en").indexOf(needle.toLocaleLowerCase("en"));
 if(i<0)return null;
 return {start:i,end:i+needle.length,quote:question.slice(i,i+needle.length)};
}
function expandWords(question:string,span:Span,before:number,after:number):Span {
 const space=(c:string)=>/\s/u.test(c);
 let {start,end}=span,left=0,right=0;
 while(start>0&&left<before){
  let i=start-1;while(i>=0&&space(question[i]!))i--;
  if(i<0)break;
  let j=i;while(j>=0&&!space(question[j]!))j--;
  start=j+1;left++;
 }
 while(end<question.length&&right<after){
  let i=end;while(i<question.length&&space(question[i]!))i++;
  if(i>=question.length)break;
  let j=i;while(j<question.length&&!space(question[j]!))j++;
  end=j;right++;
 }
 return {start,end,quote:question.slice(start,end)};
}
function currencyNeedles(value:string,unit:string|null):string[] {
 if(!unit||!/^(USD|EUR|GBP)$/iu.test(unit))return [];
 const n=Number(value);
 if(!Number.isFinite(n))return [];
 const sign=unit.toUpperCase()==="EUR"?"€":unit.toUpperCase()==="GBP"?"£":"$";
 const needles=[`${sign}${value}`,`${sign}${n}`];
 if(n>=1000&&n%1000===0)needles.push(`${sign}${n/1000}k`,`${sign}${n/1000}K`,`under ${sign}${n/1000}k`);
 return needles;
}
function namedQuestionSpans(question:string):Span[] {
 const spans:Span[]=[];
 for(const match of question.matchAll(/\b[A-Z][\p{L}']{2,}\b/gu)) {
  const found={start:match.index!,end:match.index!+match[0].length,quote:match[0]};
  const expanded=expandWords(question,found,2,0);
  const candidate=expanded.quote.trim()===question.trim()?found:expanded;
  if(candidate.quote.trim()!==question.trim())spans.push(candidate);
 }
 return spans;
}
/** A tighter original-question span for an unmet hard constraint. Never uses source text. */
export function tightenCriterionSpan(question:string,criterion:Criterion):Span|null {
 const value=criterion.value?.trim()??"";
 const unit=criterion.unit?.trim()??null;
 const field=criterion.field?.trim()??"";
 const needles=[
  ...(value&&unit?[`${value}${unit}`,`${value} ${unit}`,`${value}${unit} of ${field}`,`${value} ${unit} of ${field}`]:[]),
  ...currencyNeedles(value,unit),
  ...(value?[value]:[]),
 ].filter((n)=>n&&n.length>1);
 let best:Span|null=null;
 for(const needle of needles){
  const found=findInQuestion(question,needle);
  if(!found)continue;
  const expanded=found.quote.includes(" ")?found:expandWords(question,found,2,3);
  const candidate=expanded.quote.trim()===question.trim()?found:expanded;
  if(candidate.quote.trim()===question.trim())continue;
  if(!best||candidate.quote.length>best.quote.length)best=candidate;
 }
 if(best&&question.slice(best.start,best.end)===best.quote)return best;
 const assumed=criterion.value?.trim();
 if(!assumed||findInQuestion(question,assumed))return null;
 const named=namedQuestionSpans(question).sort((a,b)=>b.quote.length-a.quote.length)[0];
 return named&&question.slice(named.start,named.end)===named.quote?named:null;
}
/** Narrow discovery to unmet criteria without copying any source text into public queries. */
export function nextCriterionSearch(args:{question:string;task:ResearchModelOutput<"brief">;unresolvedCriterionKeys:string[];queries:string[];ceiling?:number}) {
 const seen=new Set(args.queries.map(normalize));
 const ceiling=args.ceiling??MAX_DISCOVERY_QUERIES;
 if(seen.size>=ceiling)return {kind:"stop" as const,reason:"discovery_query_limit"};
 for(const criterion of args.task.criteria) {
  if(!args.unresolvedCriterionKeys.includes(criterion.key))continue;
  let basis:Span=criterion.provenance,query=basis.quote.trim();
  if(basis.start<0||basis.end<=basis.start||args.question.slice(basis.start,basis.end)!==basis.quote)throw new Error("invalid_discovery_provenance");
  if(!query||query.length>4000||seen.has(normalize(query))){
   const tight=tightenCriterionSpan(args.question,criterion);
   if(!tight||seen.has(normalize(tight.quote)))continue;
   basis=tight;query=tight.quote.trim();
  }
  const questionKeys=args.task.questions.filter((q)=>q.criterionKeys.includes(criterion.key)).map((q)=>q.key);
  if(!questionKeys.length||questionKeys.length>12)continue;
  return {kind:"search" as const,proposal:{rationale:"Investigate an unresolved criterion using its original question wording.",action:{type:"search" as const,query,questionKeys,publicQueryBasis:basis}}};
 }
 return {kind:"stop" as const,reason:"no_distinct_public_criterion_query"};
}
