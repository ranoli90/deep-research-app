import { describe, expect, it } from "vitest";
import { authorizePublicQuery, validateModelBindings } from "../src/index.js";

const question = "What about battery life?";
const basis = {start:0,end:question.length,quote:question};
const scope = {entity:null,plan:null,version:null,geography:null,time:null,population:null};
const task = {objective:question,objectiveProvenance:basis,intendedOutput:"Battery comparison",
  criteria:[{key:"c1",description:"Battery life",field:"battery",operator:"compare" as const,value:null,
    unit:null,importance:"hard" as const,scope,provenance:basis,group:"g1",groupOperator:"all" as const,
    unresolvedAlternatives:[]}],
  questions:[{key:"q1",text:"How long does the laptop last?",criterionKeys:["c1"],
    importance:"critical" as const,evidenceStandard:"measured test"}],
  assumptions:[],openAmbiguities:[],explicitExclusions:[]};
const context = {question,task,passages:[],sources:[],assertions:[],approvedClaimKeys:[]};
const proposal = (query:string,publicQueryBasis=basis) => ({rationale:"Find public battery evidence",
  action:{type:"search" as const,query,questionKeys:["q1"],publicQueryBasis}});

describe("claimed public context query binding",()=>{
  it("allows only explicit server-resolved public passage terms beside the exact child-question span",()=>{
    const query="What about battery life? Acme Model Z";
    expect(validateModelBindings("propose_action",proposal(query),context)).toContain("unapproved_public_query_terms");
    const approved={...context,approvedPublicContextTerms:["Acme","Model","Z"]};
    expect(validateModelBindings("propose_action",proposal(query),approved)).toEqual([]);
    expect(authorizePublicQuery({question,query,publicEvidenceText:"Acme Model Z",expand:false}).kind).toBe("authorized");
    expect(validateModelBindings("propose_action",proposal(`${query} PRIVATECODE`),approved))
      .toContain("unapproved_public_query_terms");
    expect(validateModelBindings("propose_action",proposal(query,{...basis,start:1}),approved))
      .toContain("invalid_exact_span");
  });

  it("does not turn a private document term into public evidence permission",()=>{
    const query="What about battery life? PRIVATECODE";
    const result=authorizePublicQuery({question,query,publicEvidenceText:"Acme Model Z",
      privateDocumentText:"PRIVATECODE",expand:false});
    expect(result.kind).not.toBe("authorized");
  });
});
