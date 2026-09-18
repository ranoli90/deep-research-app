/** Nonbillable production-worker probe: known contradiction must not vanish at the model context boundary. */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {CreateRunRequestSchema} from '../../../packages/contracts/src/index.js';
import {createPool,migrate,withTx} from '../../../apps/backend/src/platform/db.js';
import {createDevSession,grantConsent,deleteAccount} from '../../../apps/backend/src/modules/access.js';
import {admitRun} from '../../../apps/backend/src/modules/run-admission.js';
import {insertSource,insertExtractedVersion} from '../../../apps/backend/src/modules/evidence.js';
import {loadConfig} from '../../../apps/backend/src/platform/config.js';
import {processRun} from '../../../apps/backend/src/worker/executor.js';
import {getLatestReportForRun} from '../../../apps/backend/src/modules/reports.js';
import {matchedDocumentModel} from '../../../apps/backend/test/helpers/matched-model.js';
const url='postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_selection_extraction_20260918';
const pool=createPool(url),originalFetch=globalThis.fetch;
const question='Which firmware supports Ardent offline recording?',fact='Ardent supports offline recording only on firmware 4.2.',opposite='Ardent does not support offline recording on firmware 4.2.';
const results=[];
try{
 await migrate(pool);
 for(const large of [false,true]){
  const accountId=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s.accountId;});
  try{
   const run=await admitRun(pool,accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:'controlled-research'}));
   const locator=`https://example.org/probe-${crypto.randomUUID()}`,sourceId=await insertSource(pool,{accountId,runId:run.runId,locator,title:'Synthetic contradictory firmware note',publisher:'Synthetic',originCluster:'synthetic',sourceType:'web'});
   const texts=Array.from({length:20},(_,i)=>i===0?fact:i===11?opposite:`Background ${i}. ${'x'.repeat(large&&[9,10,12,13].includes(i)?23980:100)}`),bytes=Buffer.from(texts.join('\n'));
   await insertExtractedVersion(pool,{accountId,runId:run.runId,sourceId,bytes,receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:'text/plain',retrievedAt:new Date().toISOString(),outcome:'successful_body'},extraction:{version:'utf8-notes-v1',digest:createHash('sha256').update(bytes).digest('hex'),status:'extracted',warnings:[],blocks:texts.map((text,i)=>({kind:'text',locator:`paragraph:${i}`,text,rows:[]}))}});
   const model=matchedDocumentModel();globalThis.fetch=model.transport;
   const config=loadConfig({DATABASE_URL:url,NODE_ENV:'test',APP_AUTH_MODE:'development',LIVE_ROUTE_ENABLED:'true',STRUCTURED_MODEL_ENABLED:'true',OPENROUTER_API_KEY:'nonbillable-omitted-contradiction',LIVE_KEY_SPEND_CAP_MICRO:'1000000000',LIVE_SPEND_CAP_MICRO:'1000000',LIVE_BUDGET_SCOPE:crypto.randomUUID()});
   await processRun(pool,config,run.runId);
   const report=await getLatestReportForRun(pool,run.runId,accountId),passages=(await pool.query('SELECT id,exact_text,content_hash,locator FROM authorized_run_passages WHERE run_id=$1 AND account_id=$2 ORDER BY id',[run.runId,accountId])).rows;
   const selections=(await pool.query('SELECT id,selection,proof_digest FROM evidence_selections WHERE run_id=$1 AND account_id=$2',[run.runId,accountId])).rows;
   const selected=new Set(selections.flatMap(s=>s.selection.passageIds));
   const checks=(await pool.query('SELECT decision,result FROM scoped_support_results WHERE run_id=$1 AND account_id=$2',[run.runId,accountId])).rows;
   const inventoryChecks=(await pool.query('SELECT decision,result FROM selection_inventory_checks WHERE run_id=$1 AND account_id=$2',[run.runId,accountId])).rows;
   const events=(await pool.query('SELECT type,payload FROM run_events WHERE run_id=$1 AND account_id=$2 ORDER BY sequence',[run.runId,accountId])).rows;
   const withheld=!report?.blocks.some((b:{text:string})=>b.text===fact);
   results.push({large,runId:run.runId,withheld,contradictionExtracted:passages.some(p=>p.exact_text===opposite),contradictionSelected:passages.some(p=>p.exact_text===opposite&&selected.has(p.id)),report,passages,selections,checks,inventoryChecks,events});
  }finally{await deleteAccount(pool,accountId);}
 }
}finally{globalThis.fetch=originalFetch;await pool.end();}
const result={evidenceClass:'production worker and real PostgreSQL; fabricated model/extraction transports; no paid calls',requirement:'W01 known contradictory evidence cannot become support merely by being omitted from model context',results,paidCostMicro:0,exitCode:results.every(r=>r.withheld)?0:1};
writeFileSync(new URL('./OMITTED_CONTRADICTION_AFTER.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({exitCode:result.exitCode,results:results.map(({large,withheld,contradictionExtracted,contradictionSelected})=>({large,withheld,contradictionExtracted,contradictionSelected}))},null,2));process.exitCode=result.exitCode;
