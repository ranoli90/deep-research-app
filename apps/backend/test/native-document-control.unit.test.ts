import { createHash } from "node:crypto";
import { expect,it } from "vitest";
import { CARD,FIRMWARE,UNDERWATER,nativeDocumentAssertions,nativeDocumentReport } from "./native-document-control.js";
const passage=(text:string)=>({id:crypto.randomUUID(),sourceVersionId:crypto.randomUUID(),digest:createHash("sha256").update(text).digest("hex"),accessLevel:"full-text",text});
const context=(texts:string[])=>({question:"Which firmware supports Ardent offline recording?",task:null,passages:texts.map(passage),sources:[],assertions:[],approvedClaimKeys:[],draft:null});
it("preserves old underwater and firmware controls without inventing card evidence",()=>{
 const c=context([FIRMWARE,UNDERWATER]);expect(nativeDocumentAssertions(c).assertions.map(a=>a.text)).toEqual([FIRMWARE]);
 expect(nativeDocumentAssertions({...c,question:"What about underwater recording?"}).assertions.map(a=>a.text)).toEqual([UNDERWATER]);
});
it("binds additional fact to new exact passage and renders both approved statements",()=>{
 const c=context([FIRMWARE,"New supplementary note: "+CARD]);const out=nativeDocumentAssertions(c);
 expect(out.assertions).toHaveLength(2);expect(out.assertions[1]!.evidence).toEqual([{passageId:c.passages[1]!.id,start:24,end:24+CARD.length,quote:CARD}]);
 const report=nativeDocumentReport({...c,assertions:out.assertions,approvedClaimKeys:["recording","card"]});
 expect(report.sections[0]!.paragraphs).toEqual([{text:FIRMWARE,claimKeys:["recording"]},{text:CARD,claimKeys:["card"]}]);
 expect(nativeDocumentReport({...c,assertions:out.assertions,approvedClaimKeys:["recording"]}).sections[0]!.paragraphs).toHaveLength(1);
});
it("refuses missing required statement, tampered digest, malformed identity and duplicate passage binding",()=>{
 expect(()=>nativeDocumentAssertions(context([CARD]))).toThrow("did not contain");
 const c=context([FIRMWARE]);c.passages[0]!.text+=" changed";expect(()=>nativeDocumentAssertions(c)).toThrow("identity mismatch");
 const bad=context([FIRMWARE]);expect(()=>nativeDocumentAssertions({...bad,passages:[{...bad.passages[0],sourceVersionId:"invalid"}]})).toThrow();
 const duplicate=context([FIRMWARE]);duplicate.passages.push(duplicate.passages[0]!);expect(()=>nativeDocumentAssertions(duplicate)).toThrow("identity mismatch");
});
it("refuses writing when no assertion has approval",()=>{
 const c=context([FIRMWARE]);expect(()=>nativeDocumentReport({...c,assertions:nativeDocumentAssertions(c).assertions})).toThrow("no approved");
});
