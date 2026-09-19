import { COUNTEREVIDENCE_SUFFIX,COUNTEREVIDENCE_VERSION,CounterevidenceActionSchema,type ResearchModelOutput } from "@deep/contracts";
import type { ScopedSupportResult } from "./scoped-support.js";
export function counterevidenceQuestion(texts:string[]) {return `What evidence contradicts or materially qualifies these exact statements? ${texts.map(text=>`“${text}”`).join("; ")}`;}
/** A bounded check targets one consequential question. It never claims all conclusions were challenged. */
export function selectCounterevidenceAction(task:ResearchModelOutput<"brief">,assertions:ResearchModelOutput<"extract_assertions">["assertions"],checks:ScopedSupportResult[]) {
 for(const question of [...task.questions].sort((a,b)=>Number(b.importance==="critical")-Number(a.importance==="critical"))) {
  const claimKeys=assertions.filter(a=>a.criterionKeys.some(k=>question.criterionKeys.includes(k))&&checks.some(c=>c.claimKey===a.key&&c.decision==="supported")).slice(0,6).map(a=>a.key);
  if(claimKeys.length)return CounterevidenceActionSchema.parse({type:"challenge",claimKeys,questionKeys:[question.key],question:counterevidenceQuestion(claimKeys.map(key=>assertions.find(a=>a.key===key)!.text)),hypothesis:"contradiction_or_missing_qualification"});
 }
 return null;
}
/** One challenge object per consequential conclusion. Independent of the run-level counterevidence row. */
export function selectConsequentialConclusions(task:ResearchModelOutput<"brief">,assertions:ResearchModelOutput<"extract_assertions">["assertions"],checks:ScopedSupportResult[]) {
 const out:{conclusionKey:string;conclusionText:string;questionKey:string}[]=[];
 const seen=new Set<string>();
 for(const question of [...task.questions].sort((a,b)=>Number(b.importance==="critical")-Number(a.importance==="critical"))) {
  for(const assertion of assertions) {
   if(seen.has(assertion.key)||!assertion.criterionKeys.some(k=>question.criterionKeys.includes(k)))continue;
   const check=checks.find(c=>c.claimKey===assertion.key);
   if(!check||!["supported","partially_supported"].includes(check.decision))continue;
   seen.add(assertion.key);
   out.push({conclusionKey:assertion.key,conclusionText:assertion.text,questionKey:question.key});
  }
 }
 return out;
}
/** Only user-provided public question wording and a closed application-owned suffix can be disclosed. */
export function counterevidenceSearch(question:string,questionKeys:string[]) {
 const query=`${question.trim()} ${COUNTEREVIDENCE_SUFFIX}`;
 if(query.length>4000)return null;
 return {rationale:"Seek contradictory evidence or missing qualifications for the original public research question.",action:{type:"search" as const,query,questionKeys,
 publicQueryBasis:{start:0,end:question.length,quote:question},queryTransform:COUNTEREVIDENCE_VERSION}};
}
export function counterevidenceOutcome(checks:ScopedSupportResult[]) {
 if(checks.some(c=>["contradicted","disputed","partially_supported"].includes(c.decision)))return "counterevidence_found" as const;
 if(checks.length&&checks.every(c=>c.decision==="supported"))return "no_counterevidence_found_in_inspected_evidence" as const;
 return "unresolved_at_limit" as const;
}
