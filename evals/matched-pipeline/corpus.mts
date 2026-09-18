import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractOffline } from "../../apps/backend/src/adapters/extraction/offline.js";
import { isBlockedIp } from "../../apps/backend/src/platform/ssrf.js";
import { pinnedRequest } from "../../apps/backend/src/platform/pinned-http.js";
const corpusRoot=new URL("../../verification/v6/matched-corpus/",import.meta.url);
const dataRoot=new URL("./",import.meta.url);
const sources=JSON.parse(await readFile(new URL("sources.json",dataRoot),"utf8")).sources;
const tasks=JSON.parse(await readFile(new URL("tasks.json",dataRoot),"utf8"));
const sha=(data:Uint8Array|string)=>createHash("sha256").update(data).digest("hex");
const timestamp=new Date().toISOString(),stamp=timestamp.replace(/[:.]/g,"-");
const base={version:"matched-corpus.v1",timestamp,commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingTree:"Uncommitted corpus registration",environment:{node:process.version,platform:process.platform,runtime:process.env.EXTRACTION_RUNTIME??null},paidCalls:0,humanAdjudication:null};
const normalize=(s:string)=>s.normalize("NFKC").replace(/-\s+(?=[A-Za-z])/g,"-").replace(/[\u00ad]/g,"").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/\s+/g," ").trim();
await mkdir(new URL("raw/",corpusRoot),{recursive:true});await mkdir(new URL("extracted/",corpusRoot),{recursive:true});
async function output(name:string,data:unknown){const text=JSON.stringify(data,null,2)+"\n";await writeFile(new URL(name,corpusRoot),text);await writeFile(new URL(name.replace(/\.json$/,`-${stamp}.json`),corpusRoot),text);}
if(process.argv[2]==="acquire"){
 const records=[];let failures=0;
 let prior:any={records:[]};try{prior=JSON.parse(await readFile(new URL("acquisition.json",corpusRoot),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 const allowed=new Set(sources.map((s:any)=>new URL(s.url).hostname));
 for(const source of sources){
  const cached=prior.records.find((r:any)=>r.id===source.id&&!r.error&&r.url===source.url);
  if(cached&&sha(await readFile(new URL(`raw/${source.file}`,corpusRoot)))===cached.sha256){records.push(cached);continue;}
  const started=performance.now();let url=new URL(source.url);const redirects:string[]=[];
  try{
   const signal=AbortSignal.timeout(30000);let res;
   for(let count=0;count<5;count++){
    if(url.protocol!=="https:"||url.username||url.password||url.port||!allowed.has(url.hostname))throw new Error("unregistered_acquisition_destination");
    const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>isBlockedIp(a.address)))throw new Error("unsafe_acquisition_address");
    res=await pinnedRequest(url,addresses[0]!,signal,8*1024*1024);
    if(res.status>=300&&res.status<400&&res.headers.location){redirects.push(url.href);url=new URL(res.headers.location,url);continue;}
    break;
   }
   if(!res||res.status!==200)throw new Error(`http_${res?.status??"missing"}`);
   const bytes=res.bytes;const target=new URL(`raw/${source.file}`,corpusRoot);
   try{await access(target);if(sha(await readFile(target))!==sha(bytes))throw new Error("existing_snapshot_changed_requires_new_registration");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;await writeFile(target,bytes);}
   records.push({...source,finalUrl:url.href,redirects,status:res.status,bytes:bytes.length,sha256:sha(bytes),retrievedAt:timestamp,wallMs:performance.now()-started,acquisition:"bounded_official_host_DNS_pinned_evaluator_fetch_not_production_fetch"});
  }catch(e){failures++;records.push({...source,finalUrl:url.href,redirects,error:e instanceof Error?e.message:String(e),wallMs:performance.now()-started});}
 }
 await output("acquisition.json",{...base,records,failures});console.log(JSON.stringify({sources:records.length,failures}));if(failures)process.exitCode=1;
}else if(process.argv[2]==="extract"){
 const acquisition=JSON.parse(await readFile(new URL("acquisition.json",corpusRoot),"utf8"));const records=[];let failures=0;
 for(const source of acquisition.records){
  const start=performance.now();
  if(source.error){failures++;records.push({id:source.id,error:"acquisition_unavailable",detail:source.error});continue;}
  try{
   const bytes=await readFile(new URL(`raw/${source.file}`,corpusRoot));if(sha(bytes)!==source.sha256)throw new Error("source_digest_changed");
   const result=await extractOffline(bytes,source.mime);await writeFile(new URL(`extracted/${source.id}.json`,corpusRoot),JSON.stringify(result)+"\n");
   const refs=tasks.tasks.flatMap((t:any)=>t.references.filter((r:any)=>r.sourceId===source.id));
   const matches=refs.map((r:any)=>({...r,locators:result.blocks.filter(b=>normalize(b.text).includes(normalize(r.exactSpan))).map(b=>b.locator)}));
   const fidelity=(tasks.fidelityChecks??[]).filter((c:any)=>c.sourceId===source.id).map((check:any)=>{
    let passed=false;
    if(check.kind==="table_row")passed=result.blocks.some(b=>b.kind==="table"&&b.rows.some(row=>row.length===check.cells.length&&row.every((c,i)=>normalize(c.text)===normalize(check.cells[i]))));
    if(check.kind==="same_block_span")passed=result.blocks.some(b=>b.locator===check.locator&&normalize(b.text).includes(normalize(check.span)));
    if(check.kind==="same_line_order")passed=result.blocks.some(b=>b.locator===check.locator&&b.text.split("\n").some(line=>{let from=0;return check.tokens.every((t:string)=>{const pos=normalize(line).indexOf(normalize(t),from);if(pos<0)return false;from=pos+normalize(t).length;return true;});}));
    return {...check,passed};
   });
   const missing=matches.filter((m:any)=>!m.locators.length);if(missing.length||fidelity.some((f:any)=>!f.passed)||result.status==="unavailable")failures++;
   records.push({id:source.id,sha256:result.digest,bytes:bytes.length,status:result.status,version:result.version,warnings:result.warnings,blockCount:result.blocks.length,tableCount:result.blocks.filter(b=>b.kind==="table").length,geometryCells:result.blocks.reduce((n,b)=>n+(b.geometry?.length??0),0),matches,fidelity,missingReferences:missing.length,wallMs:performance.now()-start});
  }catch(e){failures++;records.push({id:source.id,error:e instanceof Error?e.message:String(e),wallMs:performance.now()-start});}
 }
 await output("extraction.json",{...base,evidenceClass:"actual_offline_extraction_no_models",normalization:"NFKC,soft-hyphen removal,Unicode dash/minus canonicalization,physical hyphen linejoin and whitespace only; raw evidence unchanged",records,failures});console.log(JSON.stringify({sources:records.length,failures}));if(failures)process.exitCode=1;
}else if(process.argv[2]==="validate"){
 const errors:string[]=[];const ids=new Set<string>(),families=new Set<string>();
 for(const t of tasks.tasks){if(ids.has(t.id)||families.has(t.family))errors.push(`duplicate:${t.id}`);ids.add(t.id);families.add(t.family);if(t.humanAdjudication!==null||t.modelRun!==null||!t.correctedQuestion||!t.references.length)errors.push(`invalid_registration:${t.id}`);}
 if(tasks.tasks.filter((t:any)=>t.split==="development").length!==6||tasks.tasks.filter((t:any)=>t.split==="heldout").length!==6)errors.push("split_must_be_six_each");
 const acquisition=JSON.parse(await readFile(new URL("acquisition.json",corpusRoot),"utf8"));
 for(const s of acquisition.records){if(s.error){errors.push(`missing_source:${s.id}`);continue;}if(sha(await readFile(new URL(`raw/${s.file}`,corpusRoot)))!==s.sha256)errors.push(`changed_source:${s.id}`);}
 const frozen={tasksSha256:sha(await readFile(new URL("tasks.json",dataRoot))),sourcesSha256:sha(await readFile(new URL("sources.json",dataRoot))),documents:acquisition.records.filter((s:any)=>s.sha256).map((s:any)=>({id:s.id,sha256:s.sha256})),split:{development:6,heldout:6},modelExecutions:0};
 const target=new URL("FREEZE.json",dataRoot);try{const prior=JSON.parse(await readFile(target,"utf8"));if(JSON.stringify(prior)!==JSON.stringify(frozen))errors.push("frozen_registration_changed");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;if(!errors.length)await writeFile(target,JSON.stringify(frozen,null,2)+"\n");}
 await output("validation.json",{...base,evidenceClass:"registration_integrity_only",errors,freeze:frozen});console.log(JSON.stringify({errors}));if(errors.length)process.exitCode=1;
}else throw new Error("Usage: corpus.mts acquire|extract|validate; no model execution capability");
