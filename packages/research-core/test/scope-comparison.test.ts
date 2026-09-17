import { expect,it } from "vitest";
import { compareAssertionScopes } from "../src/scope-comparison.js";
import type { ResearchModelOutput } from "@deep/contracts";
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
const scope={entity:"Rill",plan:"Pro",version:"4.2",geography:"Canada",time:"2026",population:"adults"};
const claim=(key:string,patch:Partial<Assertion>={}):Assertion=>({key,candidateKey:null,criterionKeys:["offline"],text:"Scoped source statement",scope,quantities:[],evidence:[],...patch});
const run=(a:Assertion,b:Assertion)=>compareAssertionScopes({type:"compare_scopes",claimKeys:[b.key,a.key]},[a,b]);
it("compares all six scope dimensions but does not infer agreement or entailment",()=>{
 const result=run(claim("a",{text:"Supports offline editing."}),claim("b",{text:"Does not support offline editing."}));
 expect(result.pairs[0]).toMatchObject({status:"scope_matches",entailment:"not_assessed"});
 expect(result.pairs[0]!.fields.every(f=>f.relation==="equal")).toBe(true);
});
it.each(Object.keys(scope) as (keyof typeof scope)[])("preserves a %s difference without declaring contradiction",field=>{
 const result=run(claim("a"),claim("b",{scope:{...scope,[field]:"different"}}));
 expect(result.pairs[0]!.status).toBe("different_scope");
 expect(result.pairs[0]!.fields.find(f=>f.field===field)?.relation).toBe("different");
 expect(result.pairs[0]!.entailment).toBe("not_assessed");
});
it("missing scope is unknown even when both sides omit it",()=>{
 const result=run(claim("a",{scope:{...scope,version:null}}),claim("b",{scope:{...scope,version:null}}));
 expect(result.pairs[0]).toMatchObject({status:"scope_incomplete"});
 expect(result.pairs[0]!.fields.find(f=>f.field==="version")?.relation).toBe("unknown");
});
it("excludes unrelated criteria and never converts aliases into scope equality",()=>{
 expect(run(claim("a"),claim("b",{criterionKeys:["price"]}))).toMatchObject({pairs:[],excludedUnrelatedPairs:1});
 expect(run(claim("a"),claim("b",{scope:{...scope,geography:"CA"}})).pairs[0]!.status).toBe("different_scope");
});
it("rejects missing/duplicate targets and injected authority",()=>{
 expect(()=>compareAssertionScopes({type:"compare_scopes",claimKeys:["a","missing"]},[claim("a")])).toThrow("comparison_target_unavailable");
 expect(()=>compareAssertionScopes({type:"compare_scopes",claimKeys:["a","a"]},[claim("a")])).toThrow();
 expect(()=>compareAssertionScopes({type:"compare_scopes",claimKeys:["a","b"],accountId:"foreign"},[claim("a"),claim("b")])).toThrow();
 expect(run(claim("b"),claim("a"))).toEqual(run(claim("a"),claim("b")));
});
