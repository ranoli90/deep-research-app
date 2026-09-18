import { expect, it } from "vitest";
import type { ResearchModelOutput } from "@deep/contracts";
import { nextStrategySearch, researchStrategy, RESEARCH_STRATEGIES } from "../src/ports/research-strategy.js";
import { loadConfig } from "../src/platform/config.js";
const question="Compare export and offline editing.";
const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
const criteria=["export","offline editing"].map((quote,i)=>({key:`c${i}`,description:quote,field:quote,operator:"explain" as const,value:null,unit:null,importance:"hard" as const,scope,provenance:{start:question.indexOf(quote),end:question.indexOf(quote)+quote.length,quote},group:"g",groupOperator:"all" as const,unresolvedAlternatives:[]}));
const task:ResearchModelOutput<"brief">={objective:question,objectiveProvenance:{start:0,end:question.length,quote:question},intendedOutput:"answer",criteria,questions:criteria.map(c=>({key:`q${c.key}`,text:c.description,criterionKeys:[c.key],importance:"critical" as const,evidenceStandard:"Explicit evidence"})),assumptions:[],openAmbiguities:[],explicitExclusions:[]};
it("A1 iterates a fixed user-order plan while B targets the remaining gap, using identical safe query schemas",()=>{
 const args={question,task:{...task,criteria:[...criteria].reverse()},unresolvedCriterionKeys:["c1"],queries:[question]};
 expect(nextStrategySearch("iterative-baseline.v1",args)).toMatchObject({kind:"search",proposal:{action:{query:"export"}}});
 expect(nextStrategySearch("criterion-adaptive.v1",args)).toMatchObject({kind:"search",proposal:{action:{query:"offline editing"}}});
 expect(nextStrategySearch("iterative-baseline.v1",{...args,queries:[question,"export"]})).toMatchObject({kind:"search",proposal:{action:{query:"offline editing"}}});
});
it.each(RESEARCH_STRATEGIES)("%s keeps query ceiling and rejects source-derived disclosure",strategy=>{
 const args={question,task,unresolvedCriterionKeys:["c0","c1"],queries:[question,"export","offline editing"]};
 expect(nextStrategySearch(strategy,args)).toEqual({kind:"stop",reason:"discovery_query_limit"});
 const malformed={...task,criteria:[{...criteria[0]!,provenance:{start:0,end:7,quote:"PRIVATE"}}]};
 expect(()=>nextStrategySearch(strategy,{...args,task:malformed,queries:[]})).toThrow("invalid_discovery_provenance");
});
it("defaults existing configuration to adaptive and rejects invalid configured policy",()=>{
 expect(researchStrategy(undefined)).toBe("criterion-adaptive.v1");
 expect(loadConfig({DATABASE_URL:"local",STRUCTURED_RESEARCH_STRATEGY:"iterative-baseline.v1"}).structuredStrategy).toBe("iterative-baseline.v1");
 expect(()=>loadConfig({DATABASE_URL:"local",STRUCTURED_RESEARCH_STRATEGY:"fixture-baseline"})).toThrow("invalid_research_strategy");
});
