import { describe,it,expect } from "vitest";
import { resolveScopedSupport } from "../src/scoped-support.js";
const scope={entity:"Aster",plan:null,version:null,geography:null,time:null,population:null};
const pid="11111111-1111-4111-8111-111111111111";
function check(text:string,claimText:string,options:{access?:string;scope?:typeof scope;status?:"supported"|"contradicted";missing?:string[]}={}) {
  const evidence=[{passageId:pid,start:0,end:text.length,quote:text}];
  return resolveScopedSupport({assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:claimText,scope,quantities:[],evidence}],
    passages:[{id:pid,text,accessLevel:options.access??"partial-text"}],proposal:{assessments:[{claimKey:"a",status:options.status??"supported",evidence,
      scope:options.scope??scope,rationale:"The quoted evidence was compared with the asserted scope.",missingEvidence:options.missing??[]}]}})[0]!;
}
describe("scoped support execution",()=>{
  it("retains a legitimate semantic paraphrase when independent guards pass",()=>{
    const result=check("Aster can export files in CSV format.","Aster provides CSV file export.");
    expect(result.decision).toBe("supported");expect(result.checks.every((c)=>c.passed)).toBe(true);
  });
  it("vetoes an optimistic model verdict for negation",()=>expect(check("Aster does not support offline editing.","Aster supports offline editing.").decision).toBe("contradicted"));
  it("retains qualifications missing from an optimistic claim",()=>expect(check("Aster may support offline editing.","Aster supports offline editing.").decision).toBe("partially_supported"));
  it("rejects ungrounded numbers and changed units even if quantities were omitted",()=>{
    expect(check("Aster restored 12 hectares.","Aster restored 20 hectares.").decision).toBe("insufficient");
    expect(check("Aster restored 12 hectares.","Aster restored 12 acres.").decision).toBe("insufficient");
  });
  it("rejects model scope changes and unqualified snippet support",()=>{
    expect(check("Aster supports offline editing.","Aster supports offline editing.",{scope:{...scope,entity:"Other"}}).decision).toBe("out_of_scope");
    expect(check("Aster supports offline editing.","Aster supports offline editing.",{access:"snippet"}).decision).toBe("insufficient");
  });
  it("keeps model uncertainty and missing evidence instead of promoting literal overlap",()=>{
    expect(check("Aster supports offline editing.","Aster supports offline editing.",{missing:["Plan availability unknown"]}).decision).toBe("partially_supported");
    expect(check("Aster supports offline editing.","Aster supports offline editing.",{status:"contradicted"}).decision).toBe("disputed");
  });
  it("does not confuse a different entity's negation with contradiction",()=>{
    expect(check("Blaster does not support offline editing.","Aster supports offline editing.").decision).toBe("out_of_scope");
  });
  it("retains a conflict from selected counterevidence omitted by the model",()=>{
    const positive="Aster supports offline editing.";
    const negative="Aster does not support offline editing.";
    const evidence=[{passageId:pid,start:0,end:positive.length,quote:positive}];
    const result=resolveScopedSupport({assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:positive,scope,quantities:[],evidence}],
      passages:[{id:pid,text:positive,accessLevel:"partial-text"},{id:"22222222-2222-4222-8222-222222222222",text:negative,accessLevel:"partial-text"}],
      proposal:{assessments:[{claimKey:"a",status:"supported",scope,evidence,rationale:"Only positive evidence cited",missingEvidence:[]}]}});
    expect(result[0]!.decision).toBe("disputed");
    expect(result[0]!.counterEvidence).toEqual([{passageId:"22222222-2222-4222-8222-222222222222",decision:"contradicts"}]);
  });
  it("rejects a currency-symbol substitution even when the numeric value is unchanged",()=>{
    expect(check("Aster costs €12.","Aster costs $12.").decision).toBe("insufficient");
    expect(check("Aster costs €12.","Aster costs €12.").decision).toBe("supported");
  });
  it("rejects missing claim assessments",()=>expect(()=>resolveScopedSupport({assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:"Aster",scope,quantities:[],evidence:[]}],passages:[],proposal:{assessments:[]}})).toThrow("missing_claim_assessment"));
});
it("W05 separates a literal underwater prohibition from an offline-only restriction in the same page",()=>{
 const text="Aster supports offline recording only on firmware 4.2.\nAster does not support underwater recording.";
 const claim="Aster does not support underwater recording.",start=text.indexOf(claim);
 const evidence=[{passageId:pid,start,end:start+claim.length,quote:claim}];
 const result=resolveScopedSupport({assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:claim,scope,quantities:[],evidence}],passages:[{id:pid,text,accessLevel:"partial-text"}],proposal:{assessments:[{claimKey:"a",status:"supported",scope,evidence,rationale:"Exact separate prohibition",missingEvidence:[]}]}});
 expect(result[0]!.decision).toBe("supported");
});
it("W05 retains directly relevant and adjacent anaphoric qualifications",()=>{
 for(const text of ["Aster supports offline editing only on paid plans.","Aster supports offline editing. Only on paid plans.","Aster supports offline editing. However, this requires a paid plan."])
  expect(check(text,"Aster supports offline editing.").decision).toBe("partially_supported");
});
it("does not hide a grounded RAM paragraph because the model asked for an unrelated budget quote",()=>{
  const ram="The MSI Stealth 16 AI+ (model B3WF) pairs an Intel Core Ultra 9 386H processor with a dedicated NVIDIA RTX 5060 GPU (8GB VRAM), 32GB of DDR5 RAM.";
  const laptop={entity:"laptop",plan:null,version:null,geography:null,time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"paragraph_0_0",candidateKey:null,criterionKeys:["ram"],text:ram,scope:laptop,quantities:[],
    evidence:[{passageId:pid,start:0,end:ram.length,quote:ram}]}],
    passages:[{id:pid,text:ram,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"paragraph_0_0",status:"partially_supported",scope:laptop,evidence:[{passageId:pid,start:0,end:ram.length,quote:ram}],
      rationale:"RAM is quoted but the budget is unmet",missingEvidence:["Evidence that the laptop is under $2,000."]}]}})[0]!;
  expect(result.checks.every((c)=>c.passed)).toBe(true);
  expect(result.decision).toBe("supported");
});
it("grounds grouped prices and RAM quantities without requiring unquoted criterion qualifiers",()=>{
  const price="The Stealth 16 AI+ B3WF currently lists for $2,699.99 at Best Buy.";
  const ram="The MSI Stealth 16 AI+ pairs an RTX 5060 GPU (8GB VRAM), 32GB of DDR5 RAM, and a 16-inch display.";
  const laptop={entity:"laptop",plan:null,version:null,geography:null,time:null,population:null};
  const priced=resolveScopedSupport({assertions:[{key:"budget",candidateKey:null,criterionKeys:["budget"],text:price,scope:laptop,
    quantities:[{unit:"USD",value:"2699.99",currency:"USD",qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:price.length,quote:price}]}],
    passages:[{id:pid,text:price,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"budget",status:"contradicted",scope:laptop,evidence:[{passageId:pid,start:0,end:price.length,quote:price}],rationale:"Over the $2k budget",missingEvidence:[]}]}})[0]!;
  expect(priced.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(priced.decision).toBe("disputed");
  const ramResult=resolveScopedSupport({assertions:[{key:"ram",candidateKey:null,criterionKeys:["ram"],text:ram,scope:laptop,
    quantities:[{unit:"GB",value:"32",currency:null,qualifier:"at least",billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:ram.length,quote:ram}]}],
    passages:[{id:pid,text:ram,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"ram",status:"supported",scope:laptop,evidence:[{passageId:pid,start:0,end:ram.length,quote:ram}],rationale:"32GB RAM",missingEvidence:[]}]}})[0]!;
  expect(ramResult.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(ramResult.decision).toBe("supported");
});
it("does not treat a question-category entity as ungrounded when the quote names a specific product",()=>{
  const text="The ThinkPad P14s Gen 6 AMD is shockingly good. For under $2k, I now have a mobile AI lab.";
  const laptopScope={entity:"laptop",plan:null,version:null,geography:null,time:null,population:null};
  const comments="8 comments. This is so cool! Love seeing large AI models on a ThinkPad. You may prefer a desktop.";
  const evidence=[{passageId:pid,start:0,end:text.length,quote:text}];
  const result=resolveScopedSupport({
    assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:text,scope:laptopScope,quantities:[],evidence}],
    passages:[
      {id:pid,text,accessLevel:"partial-text"},
      {id:"22222222-2222-4222-8222-222222222222",text:comments,accessLevel:"partial-text"},
    ],
    proposal:{assessments:[{claimKey:"a",status:"supported",scope:laptopScope,evidence,rationale:"Quoted product evidence",missingEvidence:[]}]},
  })[0]!;
  expect(result.decision).toBe("supported");
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.counterEvidence).toEqual([]);
});
