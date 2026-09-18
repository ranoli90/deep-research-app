/** Explicit transport control. Reads only production request context, never evaluator references or arm. */
export function matchedDocumentModel() {
 const calls:string[]=[];
 const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const respond=(output:unknown)=>new Response(JSON.stringify({id:"nonbillable-matched-control",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}),{status:200});
 const transport:typeof fetch=async(input,init)=>{
  if(String(input)!=="https://openrouter.ai/api/v1/chat/completions")throw new Error("unregistered_network_request");
  const body=JSON.parse(String(init?.body));if(body.plugins?.length){
   const query=body.messages[1].content as string;calls.push(`search:${query}`);
   const suffix=query.trim()==="offline editing"?"offline":"export";
   return new Response(JSON.stringify({id:"nonbillable-matched-search",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000003"},choices:[{finish_reason:"stop",message:{annotations:[{type:"url_citation",url_citation:{url:`https://example.org/${suffix}.html`,title:"Technical note"}}]}}]}));
  }
  const context=JSON.parse(body.messages[1].content),operation=body.response_format.json_schema.name;calls.push(operation);
  const iterative=String(context.question).includes("export and offline editing");
  if(operation==="research_brief_v1"&&iterative){
   const criteria=["export","offline editing"].map((quote,i)=>({key:`c${i}`,description:quote,field:quote,operator:"explain",value:null,unit:null,importance:"hard",scope,provenance:{start:context.question.indexOf(quote),end:context.question.indexOf(quote)+quote.length,quote},group:"g",groupOperator:"all",unresolvedAlternatives:[]}));
   return respond({objective:context.question,objectiveProvenance:{start:0,end:context.question.length,quote:context.question},intendedOutput:"Explain features",criteria,questions:criteria.map(c=>({key:`q${c.key}`,text:c.description,criterionKeys:[c.key],importance:"critical",evidenceStandard:"Explicit statement"})),assumptions:[],openAmbiguities:[],explicitExclusions:[]});
  }
  if(operation==="research_extract_assertions_v1"&&iterative){
   const assertions=["supports full export.","supports offline editing."].flatMap((needle,i)=>{
    const p=context.passages.find((p:{text:string})=>p.text.includes(needle));if(!p)return [];
    const text=p.text.split(/[\n]/).flatMap((line:string)=>line.split(/(?<=\.)\s+/)).find((s:string)=>s.includes(needle))!.trim();const start=p.text.indexOf(text);
    return [{key:`c${i}`,candidateKey:null,criterionKeys:[`c${i}`],text,scope,quantities:[],evidence:[{passageId:p.id,start,end:start+text.length,quote:text}]}];
   });return respond({candidates:[],assertions,limitations:[]});
  }
  if(operation==="research_review_coverage_v1"&&iterative)return respond({questions:["c0","c1"].map(key=>{const ids=context.assertions.filter((a:{key:string;criterionKeys:string[]})=>a.criterionKeys.includes(key)&&context.approvedClaimKeys.includes(a.key)).map((a:{key:string})=>a.key);return {questionKey:`q${key}`,status:ids.length?"supported":"unresolved_at_limit",assertionKeys:ids,reason:ids.length?"Explicit statement":"Missing statement"};}),omittedRequirements:[]});
  if(operation==="research_write_report_v1"&&iterative)return respond({title:"Feature findings",sections:[{heading:"Evidence",paragraphs:context.assertions.map((a:{key:string;text:string})=>({text:a.text,claimKeys:[a.key]}))}],unresolvedQuestionKeys:[],limitations:[]});
  if(operation==="research_brief_v1") {
   const provenance={start:0,end:context.question.length,quote:context.question};
   return respond({objective:context.question,objectiveProvenance:provenance,intendedOutput:"Document-grounded answer",criteria:[{key:"requested",description:"Requested document fact",field:"recording",operator:"explain",value:null,unit:null,importance:"hard",scope,provenance,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],questions:[{key:"q",text:context.question,criterionKeys:["requested"],importance:"critical",evidenceStandard:"Explicit document statement"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]});
  }
  if(operation==="research_extract_assertions_v1") {
   const needle=context.question.includes("firmware")?"supports offline recording only on firmware":"does not support underwater recording";
   const assertions=context.passages.flatMap((p:{id:string;text:string})=>{
    const sentence=p.text.split(/[\n]/).flatMap(line=>line.split(/(?<=\.)\s+/)).find(s=>s.includes(needle));
    if(!sentence)return [];const start=p.text.indexOf(sentence);
    return [{key:"requested",candidateKey:null,criterionKeys:["requested"],text:sentence,scope,quantities:[],evidence:[{passageId:p.id,start,end:start+sentence.length,quote:sentence}]}];
   });
   return respond({candidates:[],assertions:assertions.slice(0,1),limitations:[]});
  }
  if(operation==="research_assess_support_v1")return respond({assessments:context.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Fabricated exact-span control",missingEvidence:[]}))});
  if(operation==="research_review_coverage_v1")return respond({questions:[{questionKey:"q",status:"supported",assertionKeys:context.approvedClaimKeys,reason:"Fabricated coverage control"}],omittedRequirements:[]});
  if(operation==="research_write_report_v1")return respond({title:"Document finding",sections:[{heading:"Evidence",paragraphs:[{text:context.assertions[0].text,claimKeys:[context.assertions[0].key]}]}],unresolvedQuestionKeys:[],limitations:[]});
  throw new Error(`unexpected_model_operation:${operation}`);
 };
 return {transport,calls};
}
