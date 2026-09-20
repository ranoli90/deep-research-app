/** Post-trial authenticated GET inspection only. No worker, queue start, provider or account creation. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import PgBoss from 'pg-boss';
import {buildApp} from '../../../apps/backend/src/api/app.js';
import {createPool} from '../../../apps/backend/src/platform/db.js';
import {loadConfig} from '../../../apps/backend/src/platform/config.js';
const out=new URL('./',import.meta.url),destination=new URL('JOURNEY_INSPECTION.json',out);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function main(){
 if(existsSync(destination))throw Error('inspection_already_recorded');
 const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
 const grant=JSON.parse(readFileSync(new URL('AUTHORIZATION.json',out),'utf8'));
 assert.deepEqual(grant.taskIds,['MC-D03']);assert.equal(grant.sourceMode,'frozen_supplied_document');
 const raw=readFileSync(new URL('live/receipts.jsonl',out),'utf8');
 const journal=raw.trim().split('\n').map(line=>JSON.parse(line));
 assert(journal.some(row=>row.event==='finished'),'trial_not_finished');
 const results=journal.filter(row=>row.event==='result'&&String(row.stepId).startsWith('MC-D03:'));
 assert(results.some(row=>row.receipt?.reportId),'trial_has_no_reports');
 const url=new URL(env.DATABASE_URL);
 assert(['127.0.0.1','localhost'].includes(url.hostname),'local_project_database_required');
 assert(url.pathname.startsWith('/deep_paid_'),'dedicated_paid_database_required');
 url.searchParams.set('options','-c default_transaction_read_only=on');
 const databaseUrl=url.href,pool=createPool(databaseUrl);
 const config=loadConfig({...env,DATABASE_URL:databaseUrl,OPENROUTER_API_KEY:undefined,LIVE_ROUTE_ENABLED:'false',STRUCTURED_MODEL_ENABLED:'false',STRUCTURED_DISCOVERY_ENABLED:'false',LIVE_RETRIEVAL_ENABLED:'false',DEV_ALLOW_FIXTURE_ROUTE:'false',LIVE_SPEND_CAP_MICRO:'0',LIVE_KEY_SPEND_CAP_MICRO:'0'});
 assert.equal(config.authMode,'development','local_synthetic_identity_required');
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network_forbidden_during_inspection');};
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  assert.equal((await pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
  const boss=new PgBoss({connectionString:databaseUrl,migrate:false}); // Never started; GET handlers do not enqueue.
  app=await buildApp({pool,boss,config});
  const get=async(path:string,token=env.EVAL_SESSION_TOKEN)=>app!.inject({method:'GET',url:path,headers:{authorization:`Bearer ${token}`}});
  const identity=await get('/v1/session');assert.equal(identity.statusCode,200);assert.equal(identity.json().accountId,grant.accountId);
  const library=await get('/v1/library');assert.equal(library.statusCode,200);
  const items=library.json().items;assert(Array.isArray(items));
  let foreignToken:string|undefined;
  if(typeof env.EVAL_FOREIGN_SESSION_TOKEN==='string'){
   const identity=await get('/v1/session',env.EVAL_FOREIGN_SESSION_TOKEN);
   assert.equal(identity.statusCode,200);assert.notEqual(identity.json().accountId,grant.accountId);
   foreignToken=env.EVAL_FOREIGN_SESSION_TOKEN;
  }
  const inspections:unknown[]=[];
  for(const row of results){
   const receipt=row.receipt;if(!receipt.reportId){inspections.push({stepId:row.stepId,runId:receipt.runId,status:'unrun_report_unavailable',outcome:receipt.outcome});continue;}
   const stored=(await pool.query('SELECT id,run_id,account_id,blocks FROM reports WHERE id=$1 AND redacted_at IS NULL',[receipt.reportId])).rows[0];
   assert(stored);assert.equal(stored.account_id,grant.accountId);assert.equal(stored.run_id,receipt.runId);
   assert(items.some((item:{id:string;report_id:string})=>item.id===receipt.runId&&item.report_id===receipt.reportId));
   const reopened=await get(`/v1/reports/${receipt.reportId}`);assert.equal(reopened.statusCode,200);
   const report=reopened.json();assert.equal(report.reportId,receipt.reportId);assert.equal(report.runId,receipt.runId);assert.deepEqual(report.blocks,stored.blocks);
   assert.deepEqual(report,receipt.trace.report,'report_changed_since_trial');
   const passageIds=[...new Set<string>(report.blocks.flatMap((block:{citationIds:string[]})=>block.citationIds))];assert(passageIds.length>0,'report_has_no_citations');
   const sources:unknown[]=[];
   for(const id of passageIds){
    const response=await get(`/v1/sources/${id}`);assert.equal(response.statusCode,200);const source=response.json();assert.equal(source.passageId,id);
    const passage=(await pool.query(`SELECT p.id,p.source_version_id,p.exact_text,p.content_hash,p.locator,v.content_hash AS source_digest,v.access_level
     FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.id=$1 AND p.run_id=$2 AND p.account_id=$3`,[id,receipt.runId,grant.accountId])).rows[0];assert(passage);
    assert.equal(source.sourceVersionId,passage.source_version_id);assert.equal(source.exactText,passage.exact_text);assert.equal(source.accessLevel,passage.access_level);assert.deepEqual(source.passageLocator,passage.locator);
    assert.equal(hash(source.exactText),passage.content_hash);
    const traced=receipt.trace.passages.find((p:{id:string})=>p.id===id);assert(traced);assert.equal(traced.content_hash,passage.content_hash);assert.equal(traced.source_digest,passage.source_digest);
    let foreignStatus:number|undefined;
    if(foreignToken){foreignStatus=(await get(`/v1/sources/${id}`,foreignToken)).statusCode;assert.equal(foreignStatus,404);}
    sources.push({ownerStatus:response.statusCode,passageDigest:passage.content_hash,sourceDigest:passage.source_digest,source,foreignStatus:foreignStatus??'unrun_no_existing_foreign_session'});
   }
   let foreignStatus:number|undefined;
   if(foreignToken){foreignStatus=(await get(`/v1/reports/${receipt.reportId}`,foreignToken)).statusCode;assert.equal(foreignStatus,404);}
   inspections.push({stepId:row.stepId,runId:receipt.runId,reportId:receipt.reportId,ownerStatus:reopened.statusCode,libraryMatch:true,report,sources,foreignStatus:foreignStatus??'unrun_no_existing_foreign_session'});
  }
  const evidence={version:'authenticated-journey-inspection.v1',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checkedAt:new Date().toISOString(),command:'pnpm exec tsx verification/v6/independent-continuation/inspect-journey.mts',journalSha256:hash(raw),accountId:grant.accountId,evidenceClass:'actual_local_authenticated_API_reads_of_real_model_trial',databaseReadOnly:true,externalNetworkRequests:0,providerCalls:0,createdAccounts:0,nativeUI:false,inspections,unrunSteps:journal.filter(row=>row.event==='unrun').map(row=>({stepId:row.stepId,reason:row.reason})),foreignAccountControl:foreignToken?'existing_authenticated_foreign_session':'unrun_no_existing_foreign_session'};
  const secrets=[env.OPENROUTER_API_KEY,env.EVAL_SESSION_TOKEN,env.EVAL_FOREIGN_SESSION_TOKEN].filter((value):value is string=>typeof value==='string'&&value.length>0);
  const serialized=JSON.stringify(evidence,(_key,value)=>typeof value==='string'?secrets.reduce((text,secret)=>text.split(secret).join('[redacted]'),value):value,2)+'\n';
  writeFileSync(destination,serialized,{flag:'wx',mode:0o600});
  console.log('Authenticated report/library/source inspection recorded; no provider calls or database writes.');
 }finally{await app?.close();await pool.end();globalThis.fetch=previousFetch;}
}
main().catch(()=>{console.error('Journey inspection failed; no success artifact claimed. Inspect source and trial identities without logging credentials.');process.exitCode=1;});
