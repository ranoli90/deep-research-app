import { expect,it } from "vitest";
import { counterevidenceSearch,counterevidenceOutcome,selectConsequentialConclusions,selectCounterevidenceAction } from "../src/counterevidence.js";
import type { ScopedSupportResult } from "../src/scoped-support.js";
it("W05 counterevidence query discloses only original question plus closed application words",()=>{
 expect(counterevidenceSearch("Does Zephyr support offline work?",["q1"])?.action).toEqual({type:"search",query:"Does Zephyr support offline work? contradictions limitations exceptions",questionKeys:["q1"],publicQueryBasis:{start:0,end:33,quote:"Does Zephyr support offline work?"},queryTransform:"counterevidence.v1"});
 expect(counterevidenceSearch("x".repeat(4000),["q1"])).toBeNull();
});
it("W05 counterevidence outcome never upgrades unknown or a qualification to support",()=>{
 const check=(decision:ScopedSupportResult["decision"])=>({decision} as ScopedSupportResult);
 expect(counterevidenceOutcome([check("supported")])).toBe("no_counterevidence_found_in_inspected_evidence");
 expect(counterevidenceOutcome([check("supported"),check("disputed")])).toBe("counterevidence_found");
 expect(counterevidenceOutcome([check("partially_supported")])).toBe("counterevidence_found");
 expect(counterevidenceOutcome([check("insufficient")])).toBe("unresolved_at_limit");
 expect(counterevidenceOutcome([])).toBe("unresolved_at_limit");
});
it("selects independent conclusions per supported critical question",()=>{
 const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const task={objective:"q",objectiveProvenance:{start:0,end:1,quote:"q"},intendedOutput:"comparison",criteria:[],assumptions:[],openAmbiguities:[],explicitExclusions:[],
  questions:[{key:"q0",text:"export",criterionKeys:["c0"],importance:"critical" as const,evidenceStandard:"x"},{key:"q1",text:"offline",criterionKeys:["c1"],importance:"critical" as const,evidenceStandard:"x"}]};
 const assertions=[{key:"export",candidateKey:null,criterionKeys:["c0"],text:"export works",scope,quantities:[],evidence:[]},{key:"offline",candidateKey:null,criterionKeys:["c1"],text:"offline works",scope,quantities:[],evidence:[]}];
 const checks=[{claimKey:"export",decision:"supported" as const},{claimKey:"offline",decision:"supported" as const}];
 const selected=selectConsequentialConclusions(task as never,assertions as never,checks as never);
 expect(selected.map((c)=>c.conclusionKey).sort()).toEqual(["export","offline"]);
});

it("ENG-024 challenges partially supported consequential claims in both production selectors",()=>{
 const task={questions:[{key:"critical",importance:"critical",criterionKeys:["criterion"]}]} as never;
 const assertions=[{key:"partial",text:"A qualified finding",criterionKeys:["criterion"]}] as never;
 const checks=[{claimKey:"partial",decision:"partially_supported"}] as never;
 expect(selectConsequentialConclusions(task,assertions,checks).map(c=>c.conclusionKey)).toEqual(["partial"]);
 expect(selectCounterevidenceAction(task,assertions,checks)?.claimKeys).toEqual(["partial"]);
});
