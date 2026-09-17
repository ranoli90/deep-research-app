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
  it("rejects missing claim assessments",()=>expect(()=>resolveScopedSupport({assertions:[{key:"a",candidateKey:null,criterionKeys:["c"],text:"Aster",scope,quantities:[],evidence:[]}],passages:[],proposal:{assessments:[]}})).toThrow("missing_claim_assessment"));
});
