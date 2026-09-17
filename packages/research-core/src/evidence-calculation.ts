import { EvidenceCalculationActionSchema,EvidenceCalculationResultSchema,EVIDENCE_CALCULATION_VERSION,type EvidenceCalculationResult,type ResearchModelOutput } from "@deep/contracts";
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
type Rational={n:bigint;d:bigint};
const abs=(n:bigint)=>n<0n?-n:n;
function reduce(n:bigint,d:bigint):Rational {
 if(d===0n)throw new Error("zero_denominator");if(d<0n){n=-n;d=-d;}
 let a=abs(n),b=d;while(b){const r=a%b;a=b;b=r;}return {n:n/a,d:d/a};
}
function decimal(text:string):Rational|null {
 if(!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text))return null;
 const sign=text.startsWith("-")?-1n:1n,[whole,fraction=""]=text.replace(/^-/u,"").split(".");
 return reduce(sign*BigInt(whole!+fraction),10n**BigInt(fraction.length));
}
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const currencies=new Set(["USD","EUR","GBP","CAD","AUD","NZD","JPY","CHF","CNY","INR","HKD","SGD","SEK","NOK","DKK","KRW","BRL","MXN","ZAR"]);
const uncertain=/\b(?:not|never|no|without|may|might|could|approximately|about|starting|from|up to|at least|at most|between|unless|except|subject to)\b|[~≤≥<>]/iu;
/** Deliberately bounded numeric binding. Unsupported notation is unknown, never coerced. */
function quantityBound(claim:Assertion,q:Assertion["quantities"][number]):Assertion["evidence"]|null {
 if(q.qualifier!==null||uncertain.test(claim.text)||!/[\p{L}%]/u.test(q.unit)||q.unit.trim()!==q.unit)return null;
 // Currency metadata must name the same printed unit. No exchange or symbol interpretation.
 if(q.currency!==null&&q.currency!==q.unit)return null;
 const suffix=q.billingPeriod===null?"":`\\s+(?:per\\s+|/\\s*)${escaped(q.billingPeriod)}`;
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}.,+-])${escaped(q.value)}\\s+${escaped(q.unit)}${suffix}(?![\\p{L}\\p{N}_/])`,"u");
 const matches=(text:string)=>{
  const found=[...text.matchAll(new RegExp(pattern.source,"gu"))];if(found.length!==1)return null;
  const match=found[0]!;
  if(q.billingPeriod===null&&/^\s*(?:\/|per\b|each\b|a\s+(?:month|year|week|day)\b|monthly\b|yearly\b|annually\b|weekly\b|daily\b)/iu.test(text.slice(match.index+match[0].length)))return null;
  return match;
 };
 if(!matches(claim.text))return null;
 const evidence=claim.evidence.flatMap(e=>{
  const match=matches(e.quote);return match?[{passageId:e.passageId,start:e.start+match.index,end:e.start+match.index+match[0].length,quote:match[0]}]:[];
 });
 return evidence.length?evidence:null;
}
/** Arithmetic proof only: does not establish invoice totals, population aggregation or eligibility. */
export function calculateEvidence(action:unknown,assertions:Assertion[],supportedKeys:ReadonlySet<string>):EvidenceCalculationResult {
 const request=EvidenceCalculationActionSchema.parse(action),inputs:EvidenceCalculationResult["inputs"]=[],numbers:Rational[]=[];
 const usedEvidence=new Set<string>();
 const unknown=(reason:string)=>EvidenceCalculationResultSchema.parse({version:EVIDENCE_CALCULATION_VERSION,status:"unknown",formula:request.formula,reason,inputs,output:null,assumptions:[]});
 const arity=request.formula==="annual_cost"?1:["difference","product","ratio","percentage"].includes(request.formula)?2:null;
 if((arity!==null&&request.inputs.length!==arity)||(request.formula==="sum"&&request.inputs.length<2))return unknown("invalid_formula_arity");
 for(const ref of request.inputs) {
  const matches=assertions.filter(a=>a.key===ref.claimKey);
  if(matches.length!==1||!supportedKeys.has(ref.claimKey))return unknown("unsupported_input_claim");
  const claim=matches[0]!,q=claim.quantities[ref.quantityIndex];
  if(!q)return unknown("missing_quantity");
  const value=decimal(q.value);if(!value)return unknown("ambiguous_or_unbounded_number");
  const evidence=quantityBound(claim,q);if(!evidence)return unknown("quantity_binding_or_qualification_unresolved");
  const bindings=evidence.map(e=>`${e.passageId}:${e.start}:${e.end}`);
  if(bindings.some(key=>usedEvidence.has(key)))return unknown("duplicate_quantity_evidence");
  bindings.forEach(key=>usedEvidence.add(key));
  inputs.push({...ref,value:q.value,evidence,unit:q.unit,currency:q.currency,billingPeriod:q.billingPeriod});numbers.push(value);
 }
 const first=inputs[0]!,same=inputs.every(i=>i.unit===first.unit&&i.currency===first.currency&&i.billingPeriod===first.billingPeriod);
 let result=numbers[0]!,unit=first.unit,currency=first.currency,billingPeriod=first.billingPeriod;
 const assumptions=["Arithmetic on the cited inputs only; matching units do not establish matching scope, independent observations or a verified real-world total."];
 if(request.formula==="annual_cost") {
  if(first.billingPeriod!=="month"||first.currency===null||!currencies.has(first.currency))return unknown("annual_cost_requires_explicit_monthly_currency");
  result=reduce(result.n*12n,result.d);billingPeriod="year";
  assumptions.push("Assumes twelve identical monthly charges; unreported taxes, fees, discounts and rate changes are excluded.");
 } else if(request.formula==="product") {
  const second=inputs[1]!;
  if(second.unit!=="count"||second.currency!==null||second.billingPeriod!==null||numbers[1]!.d!==1n||numbers[1]!.n<0n)return unknown("product_requires_explicit_count_multiplier");
  result=reduce(result.n*numbers[1]!.n,result.d*numbers[1]!.d);
 } else {
  if(!same)return unknown("incompatible_units_currency_or_period");
  if(request.formula==="sum")for(const value of numbers.slice(1))result=reduce(result.n*value.d+value.n*result.d,result.d*value.d);
  if(request.formula==="difference") {result=reduce(result.n*numbers[1]!.d-numbers[1]!.n*result.d,result.d*numbers[1]!.d);if(["%","percent","percentage"].includes(unit))unit="percentage points";}
  if(request.formula==="ratio"||request.formula==="percentage") {
   if(numbers[1]!.n===0n)return unknown("zero_denominator");
   result=reduce(result.n*numbers[1]!.d*(request.formula==="percentage"?100n:1n),result.d*numbers[1]!.n);
   unit=request.formula==="percentage"?"percent":"ratio";currency=null;billingPeriod=null;
  }
 }
 return EvidenceCalculationResultSchema.parse({version:EVIDENCE_CALCULATION_VERSION,status:"computed",formula:request.formula,
  reason:"exact_arithmetic",inputs,output:{numerator:result.n.toString(),denominator:result.d.toString(),unit,currency,billingPeriod},assumptions});
}
