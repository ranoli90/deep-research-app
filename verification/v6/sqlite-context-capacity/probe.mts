import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {extractOffline} from '../../../apps/backend/src/adapters/extraction/offline.ts';
import {prepareModelRequest} from '../../../apps/backend/src/adapters/model/openrouter.ts';
import {STRUCTURED_MODEL_POLICY,STRUCTURED_CALL_RESERVE_MICRO} from '../../../apps/backend/src/ports/model-policy.ts';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const bytes=readFileSync(new URL('../matched-corpus/raw/sqlite-wal.html',import.meta.url));
assert.equal(hash(bytes),'f3467b530b883d4a00574fe1a898b3d121ed72764ae28cf66941080ac0badb9e');
const extraction=await extractOffline(bytes,'text/html');
assert.equal(extraction.version,'trafilatura-2.2.0/structure-v3');assert.equal(extraction.blocks.length,75);
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const passages=extraction.blocks.map((b,i)=>({id:id(i+1),sourceVersionId:id(1000),digest:hash(b.text),text:b.text,accessLevel:'partial-text'}));
const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
const questions=['Can SQLite WAL coordinate concurrent writes across machines on a network filesystem?','How do SQLite WAL constraints change if all processes run on one host with local storage?'];
const records=[];
for(const question of questions){
 const provenance={start:0,end:question.length,quote:question};
 const task={objective:question,objectiveProvenance:provenance,intendedOutput:'analysis',criteria:[{key:'storage',description:'Assess the requested storage deployment constraints',field:'storage',operator:'compare',value:null,unit:null,importance:'hard',scope,provenance,group:'g1',groupOperator:'all',unresolvedAlternatives:[]}],questions:[{key:'q1',text:question,criterionKeys:['storage'],importance:'critical',evidenceStandard:'Documented source constraints'}],assumptions:[],openAmbiguities:[],explicitExclusions:[]};
 const context={question,task,passages,sources:[{handle:id(1001),title:'SQLite Write-Ahead Logging'}],assertions:[],approvedClaimKeys:[],draft:null};
 const prepared=prepareModelRequest('extract_assertions',context);const body=JSON.parse(prepared.body);const retained=JSON.parse(body.messages.find((m:{role:string})=>m.role==='user').content);
 assert.deepEqual(retained,context);assert.deepEqual(retained.passages.map((p:{text:string})=>p.text),extraction.blocks.map(b=>b.text));
 assert.equal(body.model,STRUCTURED_MODEL_POLICY.model);assert.equal(body.max_tokens,STRUCTURED_MODEL_POLICY.outputTokens);assert.deepEqual(body.plugins,[]);assert.equal(body.provider.allow_fallbacks,false);
 records.push({question,syntheticTask:true,contextBytes:Buffer.byteLength(JSON.stringify(context)),requestBytes:Buffer.byteLength(prepared.body),requestDigest:prepared.digest,schemaVersion:prepared.schemaVersion,promptVersion:prepared.promptVersion,policyId:prepared.policyId,passageCount:retained.passages.length,everyWholeBlockRetained:true,contextRoundtripEqual:true,policy:STRUCTURED_MODEL_POLICY,reserveMicro:STRUCTURED_CALL_RESERVE_MICRO,plugins:body.plugins,provider:body.provider,outputTokens:body.max_tokens});
}
const decisive=['WAL does not work over a network filesystem.','there can only be one writer at a time.'];
const result={rawSha256:hash(bytes),extractor:extraction.version,status:extraction.status,warnings:extraction.warnings,blockCount:extraction.blocks.length,decisiveQuotes:decisive.map(quote=>({quote,locators:extraction.blocks.filter(b=>b.text.includes(quote)).map(b=>b.locator)})),records,scope:'Actual parser and request serialization only. Synthetic task/IDs, no DB/provider/model execution, no answer or support result.'};
for(const q of result.decisiveQuotes)assert(q.locators.length>0);
writeFileSync(new URL('./context-receipt.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
