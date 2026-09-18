import { expect,it } from "vitest";
import { calculateEvidence } from "../src/evidence-calculation.js";
import type { ResearchModelOutput } from "@deep/contracts";
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
const claim=(key:string,value:string,unit="hectares",currency:string|null=null,billingPeriod:string|null=null):Assertion=>{
 const text=`The reported value is ${value} ${unit}${billingPeriod?` per ${billingPeriod}`:""}.`;
 return {key,candidateKey:null,criterionKeys:["c"],text,scope,quantities:[{value,unit,currency,billingPeriod,qualifier:null}],
  evidence:[{passageId:`11111111-1111-4111-8111-${key.charCodeAt(0).toString().padStart(12,"0")}`,start:0,end:text.length,quote:text}]};
};
const compute=(formula:string,claims:Assertion[],approved=claims.map(c=>c.key))=>calculateEvidence({type:"calculate",formula,inputs:claims.map(c=>({claimKey:c.key,quantityIndex:0}))},claims,new Set(approved));
it("adds decimal inputs exactly without binary floating-point rounding",()=>{
 expect(compute("sum",[claim("a","0.1"),claim("b","0.2")])).toMatchObject({status:"computed",output:{numerator:"3",denominator:"10",unit:"hectares"}});
});
it("retains exact repeating ratios and defines percentage as left/right times100",()=>{
 expect(compute("ratio",[claim("a","1"),claim("b","3")])).toMatchObject({status:"computed",output:{numerator:"1",denominator:"3",unit:"ratio"}});
 expect(compute("percentage",[claim("a","1"),claim("b","3")])).toMatchObject({status:"computed",output:{numerator:"100",denominator:"3",unit:"percent"}});
});
it("difference preserves input order and identifies percentage points",()=>{
 expect(compute("difference",[claim("a","12"),claim("b","20")])).toMatchObject({status:"computed",output:{numerator:"-8",denominator:"1"}});
 expect(compute("difference",[claim("a","50","%"),claim("b","25","%")])).toMatchObject({status:"computed",output:{numerator:"25",denominator:"1",unit:"percentage points"}});
});
it("annual cost requires explicit monthly currency and states its assumptions",()=>{
 const result=compute("annual_cost",[claim("a","12.50","CAD","CAD","month")]);
 expect(result).toMatchObject({status:"computed",output:{numerator:"150",denominator:"1",currency:"CAD",billingPeriod:"year"}});
 expect(result.assumptions.join(" ")).toContain("twelve identical monthly charges");
 expect(compute("annual_cost",[claim("a","12","%","%","month")])).toMatchObject({status:"unknown",reason:"annual_cost_requires_explicit_monthly_currency"});
});
it("product permits only an explicit nonnegative integer count multiplier",()=>{
 expect(compute("product",[claim("a","12","USD","USD"),claim("b","3","count")])).toMatchObject({status:"computed",output:{numerator:"36",denominator:"1",unit:"USD"}});
 expect(compute("product",[claim("a","12"),claim("b","0.5","count")])).toMatchObject({status:"unknown",reason:"product_requires_explicit_count_multiplier"});
});
it.each(["1,000","1e3","01","1.1234567","1234567890123"])("ambiguous/unbounded number %s is unknown",value=>{
 expect(compute("sum",[claim("a",value),claim("b","2")])).toMatchObject({status:"unknown",reason:"ambiguous_or_unbounded_number",output:null});
});
it("zero denominator, incompatible currency/period and missing approval remain unknown",()=>{
 expect(compute("ratio",[claim("a","1"),claim("b","0")])).toMatchObject({status:"unknown",reason:"zero_denominator"});
 expect(compute("sum",[claim("a","12","USD","USD"),claim("b","2","EUR","EUR")])).toMatchObject({status:"unknown",reason:"incompatible_units_currency_or_period"});
 expect(compute("sum",[claim("a","12","USD","USD","month"),claim("b","2","USD","USD","year")])).toMatchObject({status:"unknown",reason:"incompatible_units_currency_or_period"});
 expect(compute("sum",[claim("a","12"),claim("b","2")],["a"])).toMatchObject({status:"unknown",reason:"unsupported_input_claim"});
});
it("does not substitute a year, discard a billing period, qualification or negative statement",()=>{
 const annual=claim("a","12","USD","USD","month");annual.quantities[0]!.billingPeriod=null;
 expect(compute("sum",[annual,claim("b","2","USD","USD")])).toMatchObject({status:"unknown",reason:"quantity_binding_or_qualification_unresolved"});
 for(const prefix of ["may be ","not ","from "]) {
  const a=claim("a","12");a.text=a.text.replace("12",`${prefix}12`);a.evidence[0]!.quote=a.text;
  expect(compute("sum",[a,claim("b","2")]).status).toBe("unknown");
 }
 const wrong=claim("a","12");wrong.text+=" Observed in2024.";wrong.quantities[0]!.value="2024";
 expect(compute("sum",[wrong,claim("b","2")]).status).toBe("unknown");
});
it("rejects authority/expression injection and duplicate operands rather than executing them",()=>{
 const action={type:"calculate",formula:"sum",inputs:[{claimKey:"a",quantityIndex:0},{claimKey:"b",quantityIndex:0}]};
 expect(()=>calculateEvidence({...action,expression:"process.exit()"},[],new Set())).toThrow();
 expect(()=>calculateEvidence({...action,inputs:[action.inputs[0],action.inputs[0]]},[],new Set())).toThrow();
});

it("duplicate source quantities cannot be double-counted through different claim aliases",()=>{
 const a=claim("a","12"),b={...a,key:"b"};
 expect(compute("sum",[a,b])).toMatchObject({status:"unknown",reason:"duplicate_quantity_evidence"});
 expect(compute("sum",[a,claim("b","12")])).toMatchObject({status:"computed",output:{numerator:"24",denominator:"1"}});
});
