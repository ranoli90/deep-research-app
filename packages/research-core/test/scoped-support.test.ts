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
it("supports a 3.12 removal paraphrase that the model marked contradicted",()=>{
  const quote="This module is no longer part of the Python standard library. It was removed in Python 3.12 after being deprecated in Python 3.10.";
  const claim="distutils is not included in the Python 3.12 standard library.";
  const scope={entity:"Python",plan:null,version:"3.12",geography:null,time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"distutils_inclusion",candidateKey:null,criterionKeys:["distutils_inclusion"],text:claim,scope,quantities:[],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"distutils_inclusion",status:"contradicted",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Model polarity error",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("grounds a federal minimum-wage statute fragment that does not repeat United States",()=>{
  const quote="$7.25 an hour, beginning 24 months after that 60th day;";
  const claim="The current federal minimum wage in the United States is $7.25.";
  const scope={entity:"federal",plan:null,version:null,geography:"United States",time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"current_minimum_wage",candidateKey:null,criterionKeys:["minimum_wage"],text:claim,scope,
    quantities:[{unit:"hour",value:"7.25",currency:"USD",qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"current_minimum_wage",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"US Code rate",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("does not ground an effective-date that the statute fragment never states",()=>{
  const quote="$7.25 an hour, beginning 24 months after that 60th day;";
  const claim="The federal minimum wage became $7.25 an hour on 2009-07-24.";
  const scope={entity:"federal",plan:null,version:null,geography:"United States",time:"2009-07-24",population:null};
  const result=resolveScopedSupport({assertions:[{key:"minimum_wage_date",candidateKey:null,criterionKeys:["minimum_wage_date"],text:claim,scope,
    quantities:[{unit:"hour",value:"7.25",currency:"USD",qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"minimum_wage_date",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Date inferred from delay language",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(false);
  expect(result.decision).toBe("out_of_scope");
});
it("grounds an EV range quote when the question category is electric car",()=>{
  const quote="With 303 miles of range and ample interior room, the 2026 LEAF is a standout at a price of just over $31,000.";
  const claim="The 2026 Nissan Leaf has an EPA range of 303 miles.";
  const scope={entity:"electric car",plan:null,version:null,geography:"US",time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"epa_range_2026_nissan_leaf",candidateKey:null,criterionKeys:["epa_range"],text:claim,scope,
    quantities:[{unit:"miles",value:"303",currency:null,qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"epa_range_2026_nissan_leaf",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"LEAF range",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("does not treat an unquoted 'has not changed' caveat as supported by a wage-rate fragment",()=>{
  const quote="$7.25 an hour, beginning 24 months after that 60th day;";
  const claim="The federal minimum wage has not changed since the last update.";
  const scope={entity:"federal",plan:null,version:null,geography:"United States",time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"limitation_0",candidateKey:null,criterionKeys:["minimum_wage"],text:claim,scope,quantities:[],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"limitation_0",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Support reused the extracted claim evidence after the model omitted a usable assessment.",missingEvidence:[]}]}})[0]!;
  expect(result.decision).toBe("insufficient");
});
it("does not treat a use-case label or a later statute 'may' as disqualifying a cited employment-tax quote",()=>{
  const quote="Under the monthly deposit schedule, deposit employment taxes on payments made during a month by the 15th day of the following month.";
  const page=`${quote} You may also have to file Form 941. This calendar is only a summary.`;
  const scope={entity:"employment tax",plan:null,version:null,geography:null,time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"frequency_of_filing",candidateKey:null,criterionKeys:["frequency_of_filing"],text:quote,scope,quantities:[],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:page,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"frequency_of_filing",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Monthly deposit rule",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.checks.find((c)=>c.rule==="qualification_preserved")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("grounds a percent claim whose numeric table cell omits the percent sign",()=>{
  const quote="Federal funds (effective) 1 2 3 | 3.63 | 3.63 | 3.63 | 3.63 | 3.88";
  const claim="The current US federal funds rate is 3.88 percent as of September 16, 2026.";
  const scope={entity:"US",plan:null,version:null,geography:"US",time:"current",population:null};
  const result=resolveScopedSupport({assertions:[{key:"current_rate",candidateKey:null,criterionKeys:["current_rate"],text:claim,scope,
    quantities:[{unit:"percentage",value:"3.88",currency:null,qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"current_rate",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Table cell",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("grounds a mixed-fraction federal funds range and US/current question labels",()=>{
  const quote="The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.";
  const claim="The current target range for the federal funds rate is 3-3/4 to 4 percent.";
  const scope={entity:"US",plan:null,version:null,geography:"United States",time:"current",population:null};
  const result=resolveScopedSupport({assertions:[{key:"current_rate",candidateKey:null,criterionKeys:["current_rate"],text:claim,scope,
    quantities:[
      {unit:"percentage",value:"3.75",currency:null,qualifier:"lower bound",billingPeriod:null},
      {unit:"percentage",value:"4.00",currency:null,qualifier:"upper bound",billingPeriod:null},
    ],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"current_rate",status:"supported",scope,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"Fed target range",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="scope_grounded_in_quotes")!.passed).toBe(true);
  expect(result.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("grounds hyphenated measured ranges that appear in the quote",()=>{
  const claim="Texas has no income tax but averages 1.6-2.2% annual property taxes on assessed value, among the highest in the country.";
  const texas={entity:"Texas",plan:null,version:null,geography:null,time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"cost_of_living",candidateKey:null,criterionKeys:["cost"],text:claim,scope:texas,
    quantities:[{unit:"%",value:"1.6-2.2",currency:null,qualifier:"annual property taxes",billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:claim.length,quote:claim}]}],
    passages:[{id:pid,text:claim,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"cost_of_living",status:"partially_supported",scope:texas,evidence:[{passageId:pid,start:0,end:claim.length,quote:claim}],
      rationale:"Taxes quoted without a home-city comparison",missingEvidence:["Current location cost of living"]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="quantities_grounded")!.passed).toBe(true);
  expect(result.decision).toBe("supported");
});
it("does not treat a model name number as an ungrounded RAM quantity",()=>{
  const claim="The MSI Stealth 16 AI+ has 32GB of DDR5 RAM.";
  const quote="RAM 32GB DDR5 at 5600 MT/s (2 SO-DIMM slots, up to 128GB)";
  const laptop={entity:"laptop",plan:null,version:null,geography:null,time:null,population:null};
  const result=resolveScopedSupport({assertions:[{key:"ram",candidateKey:null,criterionKeys:["ram"],text:claim,scope:laptop,
    quantities:[{unit:"GB",value:"32",currency:null,qualifier:null,billingPeriod:null}],
    evidence:[{passageId:pid,start:0,end:quote.length,quote}]}],
    passages:[{id:pid,text:quote,accessLevel:"partial-text"}],
    proposal:{assessments:[{claimKey:"ram",status:"supported",scope:laptop,evidence:[{passageId:pid,start:0,end:quote.length,quote}],rationale:"32GB RAM",missingEvidence:[]}]}})[0]!;
  expect(result.checks.find((c)=>c.rule==="numbers_grounded")!.passed).toBe(true);
  expect(result.checks.find((c)=>c.rule==="numeric_context_preserved")!.passed).toBe(true);
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
