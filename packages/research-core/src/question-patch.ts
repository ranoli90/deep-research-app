import { ResearchCorrectionPatchSchema, type ResearchCorrectionPatch } from "@deep/contracts";

const high=(unit:number)=>unit>=0xd800&&unit<=0xdbff;
const low=(unit:number)=>unit>=0xdc00&&unit<=0xdfff;
function wellFormed(text:string):boolean{
 for(let i=0;i<text.length;i++){
  const unit=text.charCodeAt(i);
  if(high(unit)){if(!low(text.charCodeAt(++i)))return false;}
  else if(low(unit))return false;
 }
 return true;
}
const splitsPair=(text:string,index:number)=>index>0&&index<text.length&&high(text.charCodeAt(index-1))&&low(text.charCodeAt(index));

/** The backend computes originalSha256 from the locked owned question; no caller grants that authority. */
export function applyQuestionPatch(originalQuestion:string,originalSha256:string,raw:ResearchCorrectionPatch):string{
 const patch=ResearchCorrectionPatchSchema.parse(raw);
 if(patch.kind==="replace_question")return patch.question;
 if(patch.kind==="append_attachments")return originalQuestion;
 if(patch.originalQuestionSha256!==originalSha256)throw new Error("question_patch_digest_mismatch");
 if(patch.start>patch.end||patch.end>originalQuestion.length)throw new Error("question_patch_invalid_span");
 if(!wellFormed(originalQuestion)||!wellFormed(patch.replacement)||splitsPair(originalQuestion,patch.start)||splitsPair(originalQuestion,patch.end))throw new Error("question_patch_invalid_unicode");
 if(originalQuestion.slice(patch.start,patch.end)!==patch.quote)throw new Error("question_patch_quote_mismatch");
 const question=originalQuestion.slice(0,patch.start)+patch.replacement+originalQuestion.slice(patch.end);
 if(!question.trim()||question.length>20_000)throw new Error("question_patch_invalid_result");
 return question;
}
