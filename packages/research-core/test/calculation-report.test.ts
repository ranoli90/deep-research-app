import { expect,it } from "vitest";
import { calculationReportText } from "../src/calculation-report.js";
import { calculateEvidence } from "../src/evidence-calculation.js";
import type { ResearchModelOutput } from "@deep/contracts";
it("renders repeating arithmetic without rounding or dropping cited premise wording and assumptions",()=>{
 const assertions:ResearchModelOutput<"extract_assertions">["assertions"]=[1,3].map((value,i)=>{
  const text=`Plot ${i+1} covered ${value} hectares.`;
  return {key:`a${i}`,candidateKey:null,criterionKeys:["c"],text,scope:{entity:`plot${i}`,plan:null,version:null,geography:null,time:null,population:null},
   quantities:[{value:String(value),unit:"hectares",currency:null,billingPeriod:null,qualifier:null}],
   evidence:[{passageId:`11111111-1111-4111-8111-11111111111${i}`,start:0,end:text.length,quote:text}]};
 });
 const result=calculateEvidence({type:"calculate",formula:"ratio",inputs:assertions.map(a=>({claimKey:a.key,quantityIndex:0}))},assertions,new Set(assertions.map(a=>a.key)));
 const rendered=calculationReportText(result,assertions.map(a=>a.text))!;
 expect(rendered).toContain("= 1/3 ratio");expect(rendered).not.toContain("0.33");
 assertions.forEach(a=>expect(rendered).toContain(a.text));result.assumptions.forEach(a=>expect(rendered).toContain(a));
 expect(calculationReportText(result,[])).toBeNull();
 expect(calculationReportText({...result,status:"unknown",output:null},assertions.map(a=>a.text))).toBeNull();
});
