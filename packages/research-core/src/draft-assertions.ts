import { ResearchModelOutputs,type ResearchModelOutput } from "@deep/contracts";
import { isReportSectionLabel } from "./citations.js";
type Assertion=ResearchModelOutput<"extract_assertions">["assertions"][number];
export type DraftStatement={key:string;kind:"heading"|"text"|"caveat";text:string;premiseKeys:string[];assertion:Assertion|null};

/** Writer text is a new claim proposal, never a source. All published surfaces get checked. */
export function draftStatements(raw:ResearchModelOutput<"write_report">,source:Assertion[],approvedKeys:string[]):DraftStatement[] {
  const draft=ResearchModelOutputs.write_report.parse(raw);
  const approved=new Set(approvedKeys),byKey=new Map(source.map((a)=>[a.key,a]));
  const items:DraftStatement[]=[];
  const add=(key:string,kind:DraftStatement["kind"],text:string,keys:string[])=>{
    if(kind==="heading"&&isReportSectionLabel(text)) {items.push({key,kind,text,premiseKeys:[],assertion:null});return;}
    const premiseKeys=[...new Set(keys)];
    const premises=premiseKeys.map((id)=>{if(!approved.has(id)||!byKey.has(id))throw new Error("unapproved_writer_premise");return byKey.get(id)!;});
    if(!premises.length)throw new Error("writer_statement_without_premise");
    const scope={...premises[0]!.scope};
    for(const field of Object.keys(scope) as (keyof Assertion["scope"])[]) {
      if(premises.some((p)=>p.scope[field]!==scope[field]))scope[field]=null;
    }
    const evidence=[...new Map(premises.flatMap((p)=>p.evidence).map((e)=>[JSON.stringify(e),e])).values()];
    const quantities=[...new Map(premises.flatMap((p)=>p.quantities).filter((q)=>text.includes(q.value)).map((q)=>[JSON.stringify(q),q])).values()];
    const assertion={key,candidateKey:null,criterionKeys:[...new Set(premises.flatMap((p)=>p.criterionKeys))],text,scope,quantities,evidence};
    ResearchModelOutputs.extract_assertions.shape.assertions.element.parse(assertion);
    items.push({key,kind,text,premiseKeys,assertion});
  };
  draft.sections.forEach((section,s)=>{
    add(`heading_${s}`,"heading",section.heading,section.paragraphs.flatMap((p)=>p.claimKeys));
    section.paragraphs.forEach((p,i)=>add(`paragraph_${s}_${i}`,"text",p.text,p.claimKeys));
  });
  const allKeys=[...new Set(draft.sections.flatMap((s)=>s.paragraphs.flatMap((p)=>p.claimKeys)))];
  draft.limitations.forEach((text,i)=>add(`limitation_${i}`,"caveat",text,allKeys));
  if(items.filter((i)=>i.assertion).length>60)throw new Error("writer_assertion_limit");
  return items;
}
