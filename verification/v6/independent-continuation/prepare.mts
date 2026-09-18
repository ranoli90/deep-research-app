/** Read-only provider/database preflight and frozen grant; never resends or releases the prior unknown request. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {grantConsent} from '../../../apps/backend/src/modules/access.js';
import {createPool,withTx} from '../../../apps/backend/src/platform/db.js';
import {readProviderQuota,requireProviderCapacity} from '../../../apps/backend/src/evaluation/provider-quota.js';
import {evaluationQuestionDigest,authorize,registeredPlan,sha256} from '../../../apps/backend/src/evaluation/authorization.js';
import {preservedHeldExposure} from '../../../apps/backend/src/evaluation/held-intent-continuation.js';
const out=new URL('./',import.meta.url),root=new URL('../../../',import.meta.url);
if(existsSync(new URL('AUTHORIZATION.json',out)))throw Error('setup_already_attempted');
const previous=JSON.parse(readFileSync(new URL('../zdr-route/AUTHORIZATION.json',out),'utf8'));
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const quota=await readProviderQuota(env.OPENROUTER_API_KEY);requireProviderCapacity(quota,400000);
const pool=createPool(env.DATABASE_URL);
try{
 if((await pool.query("SELECT 1 FROM runs WHERE lifecycle<>'terminal' LIMIT 1")).rowCount)throw Error('active_runs_present');
 const rows=(await pool.query(`SELECT p.*,r.model_policy_id,b.original_question FROM provider_intents p JOIN runs r ON r.id=p.run_id JOIN research_briefs b ON b.id=r.brief_id WHERE p.confirmed_micro IS NULL`)).rows;
 if(rows.length!==1||rows[0].run_id!=='bd1dfeca-63eb-4b89-b045-6361fc984005')throw Error('unexpected_unknown_history');
 const row=rows[0];
 const files=Object.fromEntries(['protocol','freeze','tasks','sources'].map(key=>[key,readFileSync(new URL('evals/matched-pipeline/'+({protocol:'model-protocol',freeze:'FREEZE',tasks:'tasks',sources:'sources'}[key])+'.json',root),'utf8')]));
 const grant={...previous,approvalId:randomUUID(),approvalReference:'user-20260918-continue-openrouter-same-cap-held-intent-v1',issuedAt:new Date().toISOString(),taskIds:['MC-D03'],protocolSha256:sha256(files.protocol!),freezeSha256:sha256(files.freeze!),heldIntentContinuation:{version:'held-intent-continuation.v1',intents:[{intentId:row.id,runId:row.run_id,requestDigest:row.request_digest,receiptDigest:sha256(JSON.stringify(row.receipt)),questionDigest:evaluationQuestionDigest(row.original_question),reservedMicro:Number(row.reserved_max_micro),policyId:row.model_policy_id}]}};
 const raw=JSON.stringify(grant,null,2)+'\n';const checked=authorize(raw,{execute:true,operatorConfirmsUserApproval:true,approvalId:grant.approvalId,sha256:sha256(raw)});
 registeredPlan(checked,files as {protocol:string;freeze:string;tasks:string;sources:string});
 const preserved=await preservedHeldExposure(pool,checked,createHash('sha256').update('openrouter:'+env.OPENROUTER_API_KEY.trim()).digest('hex'));
 const accounting=(await pool.query('SELECT COALESCE(SUM(confirmed_micro),0)::text confirmed,COALESCE(SUM(CASE WHEN confirmed_micro IS NULL THEN reserved_max_micro ELSE 0 END),0)::text held FROM provider_intents')).rows[0];
 if(Number(accounting.confirmed)+Number(accounting.held)+100000>400000)throw Error('aggregate_budget_unavailable');
 await withTx(pool,db=>grantConsent(db,previous.accountId));
 env.STRUCTURED_MODEL_POLICY_ID='openrouter-azure-mini-zdr-discovery-v3';
 writeFileSync('/tmp/deep-paid-evaluation-env.json',JSON.stringify(env),{mode:0o600});
 writeFileSync(new URL('AUTHORIZATION.json',out),raw,{flag:'wx'});
 writeFileSync(new URL('SETUP.json',out),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checkedAt:new Date().toISOString(),quota,accountId:previous.accountId,policyId:env.STRUCTURED_MODEL_POLICY_ID,aggregateCapMicro:400000,accounting,preserved,generationRequests:0,databaseMutations:"renewed synthetic account consent only; no financial mutation",priorUnknownUnchanged:true},null,2)+'\n',{flag:'wx'});
 console.log('Independent MC-D03 registered in same account/key/scope and $0.40 cap; prior timeout unchanged; no generation.');
}finally{await pool.end();}
