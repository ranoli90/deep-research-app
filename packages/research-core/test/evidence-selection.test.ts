import {expect,it} from "vitest";
import {selectWholePassages,EVIDENCE_SELECTION_LIMITS,type SelectionPassage} from "../src/evidence-selection.js";
const passage=(i:number,text:string):SelectionPassage=>({id:`p${i}`,sourceId:"source",sourceVersionId:"version",locator:`page:${i}`,locatorDigest:`locator${i}`,text,digest:`digest${i}`,accessLevel:"partial-text",title:"Independent document"});
it("preserves every whole passage when within bounds and is permutation invariant",()=>{
 const ps=Array.from({length:128},(_,i)=>passage(i,`Content ${i}.`));const result=selectWholePassages("unfamiliar",ps);
 expect(result.kind).toBe("selected");if(result.kind!=="selected")return;expect(result.omitted).toBe(0);expect(result.passageIds).toHaveLength(128);
 expect(selectWholePassages("unfamiliar",ps.reverse())).toEqual(result);
});
it("selects a late arbitrary entity with neighboring qualifications without prefix truncation",()=>{
 for(const entity of ["Vesper","Lantana","未知"]) {
  const ps=Array.from({length:160},(_,i)=>passage(i,`Unrelated appendix ${i}. ${"x".repeat(900)}`));
  ps[149]=passage(149,"Only version 4.2; regional restrictions apply.");ps[150]=passage(150,`${entity} supports offline recording.`);ps[151]=passage(151,"Not valid underwater.");
  const result=selectWholePassages(`${entity} offline recording`,ps);expect(result.kind).toBe("selected");if(result.kind!=="selected")continue;
  expect(result.passageIds).toEqual(expect.arrayContaining(["p149","p150","p151"]));expect(result.omitted).toBeGreaterThan(0);
  expect(result.serializedBytes).toBeLessThanOrEqual(EVIDENCE_SELECTION_LIMITS.serializedBytes);expect(result.passageIds.length).toBeLessThanOrEqual(128);
  expect(selectWholePassages(`${entity} offline recording`,[...ps].reverse())).toEqual(result);
 }
});
it("retains positive and contradicting relevant passages; selection itself never declares support",()=>{
 const ps=Array.from({length:160},(_,i)=>passage(i,"Background. "+"x".repeat(900)));
 ps[10]=passage(10,"Zephyr supports offline recording.");ps[145]=passage(145,"Zephyr does not support offline recording.");
 const r=selectWholePassages("Zephyr offline recording",ps);expect(r.kind).toBe("selected");if(r.kind==="selected")expect(r.passageIds).toEqual(expect.arrayContaining(["p10","p145"]));
});
it("required original evidence is retained or fails closed with its whole neighbors",()=>{
 const ps=Array.from({length:160},(_,i)=>passage(i,"Background "+"x".repeat(900)));
 const r=selectWholePassages("new question",ps,["p140"]);expect(r.kind).toBe("selected");if(r.kind==="selected")expect(r.passageIds).toEqual(expect.arrayContaining(["p139","p140","p141"]));
 expect(selectWholePassages("q",ps,["foreign"])).toEqual({kind:"blocked",reason:"selection_required_evidence_unavailable"});
 ps[140]=passage(140,"x".repeat(24001));expect(selectWholePassages("q",ps,["p140"])).toEqual({kind:"blocked",reason:"selection_whole_bundle_exceeds_limit"});
});
it("does not drop oversized neighbors or silently truncate the candidate inventory",()=>{
 const ps=[passage(0,"x".repeat(24001)),passage(1,"Relevant tiny fact")];expect(selectWholePassages("Relevant",ps)).toEqual({kind:"blocked",reason:"selection_whole_bundle_exceeds_limit"});
 expect(selectWholePassages("q",Array.from({length:4097},(_,i)=>passage(i,"x")))).toEqual({kind:"blocked",reason:"selection_candidate_limit"});
 expect(selectWholePassages("q",[])).toEqual({kind:"blocked",reason:"selection_no_readable_evidence"});
});
it("budgets actual escaped UTF8 data and source cardinality",()=>{
 const ps=Array.from({length:150},(_,i)=>({...passage(i,'漢字\\"\n'.repeat(300)),sourceId:`s${i}`,sourceVersionId:`v${i}`}));
 const r=selectWholePassages("漢字",ps);expect(r.kind).toBe("selected");if(r.kind!=="selected")return;expect(r.omitted).toBeGreaterThan(0);expect(r.passageIds.length).toBeLessThanOrEqual(40);expect(r.serializedBytes).toBeLessThanOrEqual(48000);
});

it("does not invent adjacency when structured locator order is unavailable",()=>{
 const ps=Array.from({length:150},(_,i)=>({...passage(i,"x".repeat(1000)),locator:""}));
 expect(selectWholePassages("x",ps)).toEqual({kind:"blocked",reason:"selection_whole_bundle_exceeds_limit"});
});
