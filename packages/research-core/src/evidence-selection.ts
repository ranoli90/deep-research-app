/** Bounded retrieval, never a support decision. Missing passages remain unassessed. */
export const EVIDENCE_SELECTION_VERSION = "whole-passage-selection.v1";
export const EVIDENCE_SELECTION_LIMITS = Object.freeze({ passages:128, sources:40, serializedBytes:48_000, candidates:4096, candidateTextBytes:16_000_000 });
export type SelectionPassage = { id:string; sourceVersionId:string; sourceId:string; locator:string; locatorDigest:string; text:string; digest:string; accessLevel:string; title:string };
export type EvidenceSelection = { kind:"selected"; version:typeof EVIDENCE_SELECTION_VERSION; passageIds:string[]; available:number; omitted:number; serializedBytes:number }
 | { kind:"blocked"; reason:"selection_candidate_limit"|"selection_required_evidence_unavailable"|"selection_whole_bundle_exceeds_limit"|"selection_no_readable_evidence" };
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
// ASCII digit runs sort numerically without depending on host locale/ICU versions.
function natural(a:string,b:string):number {
 const aa=a.match(/\d+|\D+/g)??[],bb=b.match(/\d+|\D+/g)??[];
 for(let i=0;i<Math.min(aa.length,bb.length);i++) {const x=aa[i]!,y=bb[i]!;if(x===y)continue;
  if(/^\d+$/.test(x)&&/^\d+$/.test(y)){const nx=x.replace(/^0+(?=\d)/,""),ny=y.replace(/^0+(?=\d)/,"");if(nx.length!==ny.length)return nx.length-ny.length;const n=compare(nx,ny);if(n)return n;}
  return compare(x,y);
 }return aa.length-bb.length;
}
const tokens=(s:string)=>new Set(s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
const bytes=(x:unknown)=>new TextEncoder().encode(JSON.stringify(x)).length;
/** Accounts for JSON inside the model message JSON; final request policy remains authoritative. */
function cost(passages:SelectionPassage[]):number {
 const projected=passages.map(p=>({id:p.id,sourceVersionId:p.sourceVersionId,digest:p.digest,accessLevel:p.accessLevel,text:p.text}));
 const sources=[...new Map(passages.map(p=>[p.sourceId,{handle:p.sourceId,title:p.title}])).values()];
 return bytes(JSON.stringify({passages:projected,sources}));
}
const ordered=(input:readonly SelectionPassage[])=>[...input].sort((a,b)=>compare(a.sourceId,b.sourceId)||compare(a.sourceVersionId,b.sourceVersionId)||natural(a.locator,b.locator)||compare(a.digest,b.digest)||compare(a.id,b.id));
const fits=(ps:SelectionPassage[])=>ps.length<=EVIDENCE_SELECTION_LIMITS.passages&&new Set(ps.map(p=>p.sourceId)).size<=EVIDENCE_SELECTION_LIMITS.sources&&ps.every(p=>p.text.length<=24_000)&&cost(ps)<=EVIDENCE_SELECTION_LIMITS.serializedBytes;
const sameSource=(a:SelectionPassage,b:SelectionPassage)=>a.sourceVersionId===b.sourceVersionId&&a.sourceId===b.sourceId;
function locatorKind(locator:string):string {
 if(/heading/i.test(locator))return "heading";
 if(/table/i.test(locator))return "table";
 if(/footnote/i.test(locator))return "footnote";
 const m=locator.match(/^([a-z]+)/i);return (m?.[1]??"").toLowerCase();
}
function structuralNeighborIndexes(passages:SelectionPassage[],i:number):number[] {
 const anchor=passages[i]!;
 if(!anchor.locator)return [];
 const out=new Set<number>();
 let heading=-1;
 for(let j=i;j>=0;j--) {
  if(!sameSource(passages[j]!,anchor))break;
  if(locatorKind(passages[j]!.locator)==="heading"){heading=j;break;}
 }
 if(heading>=0)out.add(heading);
 const tableFrom=heading>=0?heading:Math.max(0,i-8);
 for(let j=i;j>=tableFrom;j--) {
  if(!sameSource(passages[j]!,anchor))break;
  if(locatorKind(passages[j]!.locator)==="table"){out.add(j);break;}
 }
 for(let j=i;j<passages.length&&j<=i+6;j++) {
  if(!sameSource(passages[j]!,anchor))break;
  if(locatorKind(passages[j]!.locator)==="footnote")out.add(j);
 }
 return [...out];
}
const adjacent=(passages:SelectionPassage[],i:number)=>passages[i]!.locator?[i-1,i,i+1]:passages.map((_,j)=>j);
const bundleFor=(passages:SelectionPassage[],i:number)=>[...new Set([...adjacent(passages,i),...structuralNeighborIndexes(passages,i)])].filter(j=>j>=0&&j<passages.length&&sameSource(passages[j]!,passages[i]!));

export function structuralContextIds(input:readonly SelectionPassage[],anchorIds:readonly string[]):string[] {
 const passages=ordered(input);
 const wanted=new Set(anchorIds);
 const ids:string[]=[];
 for(let i=0;i<passages.length;i++) {
  if(!wanted.has(passages[i]!.id))continue;
  for(const j of structuralNeighborIndexes(passages,i))ids.push(passages[j]!.id);
 }
 return [...new Set(ids)];
}

/** Criterion-aware ranking that still emits the whole-passage identity/omission contract. */
export function selectCriterionAwarePassages(question:string,input:readonly SelectionPassage[],requiredIds:readonly string[]=[]):EvidenceSelection {
 const first=selectWholePassages(question,input,requiredIds);
 if(first.kind!=="selected")return first;
 const extra=structuralContextIds(input,first.passageIds);
 if(!extra.length)return first;
 const merged=[...new Set([...requiredIds,...first.passageIds,...extra])];
 const withContext=selectWholePassages(question,input,merged);
 if(withContext.kind==="blocked")return first;
 return withContext;
}

export function selectWholePassages(question:string,input:readonly SelectionPassage[],requiredIds:readonly string[]=[]):EvidenceSelection {
 if(input.length>EVIDENCE_SELECTION_LIMITS.candidates||input.reduce((n,p)=>n+new TextEncoder().encode(p.text).length,0)>EVIDENCE_SELECTION_LIMITS.candidateTextBytes)return {kind:"blocked",reason:"selection_candidate_limit"};
 if(!input.length)return {kind:"blocked",reason:"selection_no_readable_evidence"};
 if(new Set(input.map(p=>p.id)).size!==input.length)throw new Error("duplicate_selection_passage");
 const passages=ordered(input);
 const required=new Set(requiredIds);if([...required].some(id=>!passages.some(p=>p.id===id)))return {kind:"blocked",reason:"selection_required_evidence_unavailable"};
 const result=(ps:SelectionPassage[]):EvidenceSelection=>({kind:"selected",version:EVIDENCE_SELECTION_VERSION,passageIds:ps.map(p=>p.id).sort(compare),available:passages.length,omitted:passages.length-ps.length,serializedBytes:cost(ps)});
 if(fits(passages))return result(passages);
 const terms=tokens(question),sets=passages.map(p=>tokens(p.text));
 const frequencies=new Map([...terms].map(t=>[t,sets.filter(s=>s.has(t)).length]));
 const scores=sets.map(s=>[...terms].reduce((score,t)=>score+(s.has(t)?1/(frequencies.get(t)||1):0),0));
 const bundle=(i:number)=>bundleFor(passages,i);
 const chosen=new Set<number>();
 for(let i=0;i<passages.length;i++)if(required.has(passages[i]!.id))for(const j of bundle(i))chosen.add(j);
 const materialize=(ids:Set<number>)=>[...ids].sort((a,b)=>a-b).map(i=>passages[i]!);
 if(!fits(materialize(chosen)))return {kind:"blocked",reason:"selection_whole_bundle_exceeds_limit"};
 // Rank evidence, not truth. Adjacent qualifiers stay with each chosen anchor; no text prefixes.
 const order=passages.map((_,i)=>i).sort((a,b)=>scores[b]!-scores[a]!||a-b);
 for(const i of order) {const next=new Set([...chosen,...bundle(i)]);if(fits(materialize(next)))for(const j of next)chosen.add(j);}
 if(!chosen.size)return {kind:"blocked",reason:"selection_whole_bundle_exceeds_limit"};
 return result(materialize(chosen));
}


export const EMPTY_SELECTION_RECOVERY_VERSION="empty-selection-recovery.v1";
/** A bounded next inspection, not relevance or support. Pack unseen whole bundles;
 * reuse the unchanged v1 selector for immutable proof and request identity.
 */
export function nextUninspectedSelection(question:string,input:readonly SelectionPassage[],inspectedIds:readonly string[]) {
 const initial=selectWholePassages(question,input);if(initial.kind==="blocked")return initial;
 const inspected=new Set(inspectedIds),passages=ordered(input);
 if([...inspected].some(id=>!passages.some(p=>p.id===id)))return {kind:"blocked" as const,reason:"inspection_inventory_mismatch"};
 const chosen=new Set<number>(),requiredIds:string[]=[];
 for(let i=0;i<passages.length;i++){
  if(inspected.has(passages[i]!.id)||chosen.has(i))continue;
  const next=new Set([...chosen,...bundleFor(passages,i)]);
  if(fits([...next].sort((a,b)=>a-b).map(j=>passages[j]!))){for(const j of next)chosen.add(j);requiredIds.push(passages[i]!.id);}
 }
 if(!requiredIds.length)return {kind:"blocked" as const,reason:passages.every(p=>inspected.has(p.id))?"inspection_inventory_exhausted":"uninspected_whole_bundle_exceeds_limit"};
 const selection=selectWholePassages(question,passages,requiredIds);
 if(selection.kind!=="selected")return selection;
 if(selection.passageIds.every(id=>inspected.has(id)))throw new Error("recovery_requires_new_evidence");
 return {kind:"recovery" as const,version:EMPTY_SELECTION_RECOVERY_VERSION,requiredIds:requiredIds.sort(compare),selection};
}
