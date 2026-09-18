/** One separately identified route diagnostic, not a retry or benchmark replacement. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {CreateRunRequestSchema} from '@deep/contracts';
import {createPool} from '../../../apps/backend/src/platform/db.js';
import {loadConfig} from '../../../apps/backend/src/platform/config.js';
import {admitRun} from '../../../apps/backend/src/modules/run-admission.js';
import {claimLease,cancelRun} from '../../../apps/backend/src/modules/runs.js';
import {fencedSession} from '../../../apps/backend/src/worker/fenced-session.js';
import {performModelOperation} from '../../../apps/backend/src/worker/model-gateway.js';
import {readProviderQuota,requireProviderCapacity} from '../../../apps/backend/src/evaluation/provider-quota.js';
const output=new URL('./ROUTE_DIAGNOSTIC.json',import.meta.url);if(existsSync(output))throw Error('diagnostic_already_attempted');
if(execFileSync('git',['status','--porcelain','--','apps/backend/src','packages'],{encoding:'utf8'}).trim())throw Error('commit_runtime_first');
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const grant=JSON.parse(readFileSync(new URL('./AUTHORIZATION.json',import.meta.url),'utf8'));
const config=loadConfig(env);const pool=createPool(config.databaseUrl);const question='Explain the information needed to assess database concurrency.';
const record:any={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),command:'pnpm --filter @deep/backend exec tsx /home/oranolio/Desktop/Deep/verification/v6/forward-accounting/diagnose-route.mts',scope:'One new route-diagnostic action under the existing $0.40 total cap; original unknown reservation retained. Not another attempt at the original research action, not benchmark quality.',startedAt:new Date().toISOString()};
let session:ReturnType<typeof fencedSession>|undefined;
// Persist a one-use marker before admission; an interrupted diagnostic is never automatically repeated.
writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
try{
 record.quotaBefore=await readProviderQuota(config.openRouterApiKey??'');requireProviderCapacity(record.quotaBefore,100000);
 record.priorIntents=(await pool.query('SELECT id,state,reserved_max_micro,confirmed_micro FROM provider_intents ORDER BY id')).rows;
 if(record.priorIntents.length!==1)throw Error('unexpected_prior_attempts');
 const {runId}=await admitRun(pool,grant.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question,routeMode:'controlled-research'}));record.runId=runId;
 const owner=crypto.randomUUID();const fence=await claimLease(pool,runId,owner,30000);if(fence===null)throw Error('lease_unavailable');
 session=fencedSession(pool,{runId,accountId:grant.accountId,owner,fence,briefRevision:1,leaseMs:30000});
 record.operation=await performModelOperation(pool,config,session,{runId,accountId:grant.accountId,fence,briefRevision:1,evidenceRevision:0,operation:'brief',context:{question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null}});
 session.stop();await cancelRun(pool,runId,grant.accountId);
 record.quotaAfter=await readProviderQuota(config.openRouterApiKey??'');record.intentsAfter=(await pool.query('SELECT id,run_id,state,reserved_max_micro,confirmed_micro,receipt FROM provider_intents ORDER BY id')).rows;
 record.finishedAt=new Date().toISOString();record.exitCode=0;
}catch{record.exitCode=1;record.error='diagnostic_incomplete_no_retry';process.exitCode=1;}
finally{session?.stop();await pool.end();writeFileSync(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));}
