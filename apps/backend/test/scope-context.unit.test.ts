import { expect,it } from "vitest";
import { compareAssertionScopes,projectScopeComparison } from "@deep/research-core";
import { prepareModelRequest } from "../src/adapters/model/openrouter.js";
import { modelInputManifest } from "../src/modules/model-operations.js";
import type { ResearchModelOutput } from "@deep/contracts";

it("W05 all1770 comparisons fit the writer with identical assertions instead of repeated scope values",()=>{
 const scope={entity:"Rill",plan:"Pro",version:"4.2",geography:"Canada",time:"2026",population:"adults"};
 const assertions:ResearchModelOutput<"extract_assertions">["assertions"]=Array.from({length:60},(_,i)=>({key:`claim_${i}`,candidateKey:null,
  criterionKeys:["capability"],text:"Rill provides offline access.",scope,quantities:[],evidence:[{passageId:"11111111-1111-4111-8111-111111111111",start:0,end:28,quote:"Rill provides offline access."}]}));
 const result=compareAssertionScopes({type:"compare_scopes",claimKeys:assertions.map(a=>a.key)},assertions);
 const compact=projectScopeComparison(result,assertions);
 const context={question:"Compare the supplied statements.",task:null,passages:[],sources:[],assertions,approvedClaimKeys:assertions.map(a=>a.key),draft:null};
 expect(result.pairs).toHaveLength(1770);expect(compact.groups[0]!.pairs).toHaveLength(1770);
 expect(()=>prepareModelRequest("write_report",{...context,scopeComparison:result})).toThrow("model_context_too_large");
 const prepared=prepareModelRequest("write_report",{...context,scopeComparison:compact});
 expect(JSON.parse(prepared.body).messages[1].content).toBe(JSON.stringify({...context,scopeComparison:compact}));
 expect(modelInputManifest({...context,scopeComparison:compact}).version).toBe("model-input.v3");
 expect(modelInputManifest({...context,scopeComparison:result}).version).toBe("model-input.v2");
 const bytes={full:Buffer.byteLength(JSON.stringify(result)),compact:Buffer.byteLength(JSON.stringify(compact)),request:Buffer.byteLength(prepared.body),pairs:result.pairs.length};
 expect(bytes.compact).toBeLessThan(bytes.full/10);expect(bytes.request).toBeLessThan(128000);
 console.info("scope-context-serialization",bytes);
});
