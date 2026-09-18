/** One separately identified route diagnostic, not a retry or benchmark replacement. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {CreateRunRequestSchema} from '../../../packages/contracts/src/index.js';
import {createPool} from '../../../apps/backend/src/platform/db.js';
import {loadConfig} from '../../../apps/backend/src/platform/config.js';
import {admitRun} from '../../../apps/backend/src/modules/run-admission.js';
import {claimLease,cancelRun} from '../../../apps/backend/src/modules/runs.js';
import {fencedSession} from '../../../apps/backend/src/worker/fenced-session.js';
import {performModelOperation} from '../../../apps/backend/src/worker/model-gateway.js';
import {readProviderQuota,requireProviderCapacity} from '../../../apps/backend/src/evaluation/provider-quota.js';
const output=new URL('./UPSTREAM_DIAGNOSTIC.json',import.meta.url);if(existsSync(output))throw Error('diagnostic_already_attempted');
if(execFileSync('git',['status','--porcelain','--','apps/backend/src','packages'],{encoding:'utf8'}).trim())throw Error('commit_runtime_first');
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const grant=JSON.parse(readFileSync(new URL('./AUTHORIZATION.json',import.meta.url),'utf8'));
const config=loadConfig(env);const pool=createPool(config.databaseUrl);const question='Describe the purpose of a database transaction.';
const record:any={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),command:'pnpm --filter @deep/backend exec tsx /home/oranolio/Desktop/Deep/verification/v6/forward-accounting/diagnose-upstream.mts',scope:'One new route-diagnostic action under the existing $0.40 total cap; original unknown reservation retained. Not another attempt at the original research action, not benchmark quality.',startedAt:new Date().toISOString()};
let session:ReturnType<typeof fencedSession>|undefined;
// Persist a one-use marker before admission; an interrupted diagnostic is never automatically repeated.
writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
try{
 record.quotaBefore=await readProviderQuota(config.openRouterApiKey??'');requireProviderCapacity(record.quotaBefore,100000);
 record.priorIntents=(await pool.query('SELECT id,state,reserved_max_micro,confirmed_micro FROM provider_intents ORDER BY id')).rows;
 if(record.priorIntents.length!==2)throw Error('unexpected_prior_attempts');
 const {runId}=await admitRun(pool,grant.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:'controlled-research'}));record.runId=runId;
 const owner=crypto.randomUUID();const fence=await claimLease(pool,runId,owner,30000);if(fence===null)throw Error('lease_unavailable');
 session=fencedSession(pool,{runId,accountId:grant.accountId,owner,fence,briefRevision:1,leaseMs:30000});
 const transport=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const response=await transport(input,init);
  if(!response.ok&&response.body){
   const reader=response.clone().body!.getReader();const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536)break;chunks.push(p.value);}
    if(size<=65536){const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));const e=parsed?.error;
     const sanitize=(x:unknown)=>typeof x==='string'?Object.values(env).filter((v):v is string=>typeof v==='string'&&v.length>20).reduce((s,secret)=>s.split(secret).join('[redacted]'),x).slice(0,1500):null;
     record.upstreamError={code:e?.code,message:sanitize(e?.message),provider:sanitize(e?.metadata?.provider_name)};
     try{const upstream=JSON.parse(e?.metadata?.raw??'{}');record.upstreamError.detail={code:sanitize(upstream?.error?.code),type:sanitize(upstream?.error?.type),message:sanitize(upstream?.error?.message)};}catch{}
    }
   }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  return response;
 };
 record.operation=await performModelOperation(pool,config,session,{runId,accountId:grant.accountId,fence,briefRevision:1,evidenceRevision:0,operation:'brief',context:{question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null}});
 session.stop();await cancelRun(pool,runId,grant.accountId);
 record.quotaAfter=await readProviderQuota(config.openRouterApiKey??'');record.intentsAfter=(await pool.query('SELECT id,run_id,state,reserved_max_micro,confirmed_micro,receipt FROM provider_intents ORDER BY id')).rows;
 record.finishedAt=new Date().toISOString();record.exitCode=0;
}catch{record.exitCode=1;record.error='diagnostic_incomplete_no_retry';process.exitCode=1;}
finally{session?.stop();await pool.end();writeFileSync(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));}
