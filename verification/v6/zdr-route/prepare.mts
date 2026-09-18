/** Same authorized account, credential and $0.40 period; new explicit route and consent. No generation. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createPool,withTx} from '../../../apps/backend/src/platform/db.js';
import {grantConsent} from '../../../apps/backend/src/modules/access.js';
import {readProviderQuota,requireProviderCapacity} from '../../../apps/backend/src/evaluation/provider-quota.js';
const out=new URL('./',import.meta.url),root=new URL('../../../',import.meta.url);
if(existsSync(new URL('AUTHORIZATION.json',out)))throw Error('setup_already_attempted');
const previous=JSON.parse(readFileSync(new URL('../forward-accounting/AUTHORIZATION.json',out),'utf8'));
const reconciled=JSON.parse(readFileSync(new URL('REJECTION_RECONCILIATION.json',out),'utf8'));
if(reconciled.exitCode!==0||reconciled.settlements.length!==3)throw Error('rejections_not_reconciled');
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const quota=await readProviderQuota(env.OPENROUTER_API_KEY);requireProviderCapacity(quota,400000);
const pool=createPool(env.DATABASE_URL);
try{
 const counts=(await pool.query("SELECT COUNT(*) FILTER (WHERE lifecycle<>'terminal')::int AS active FROM runs")).rows[0];
 if(counts.active!==0)throw Error('active_runs_present');
 const costs=(await pool.query('SELECT COUNT(*)::int AS count,COUNT(*) FILTER (WHERE confirmed_micro IS NULL)::int AS unknown,COALESCE(SUM(confirmed_micro),0)::text AS cost FROM provider_intents')).rows[0];
 if(costs.count!==3||costs.unknown!==0||costs.cost!=='0')throw Error('unexpected_paid_history');
 await withTx(pool,db=>grantConsent(db,previous.accountId));
 const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex');
 const grant={...previous,approvalId:randomUUID(),approvalReference:'user-20260918-fix-route-existing-aggregate-cap',issuedAt:new Date().toISOString(),expiresAt:previous.expiresAt,protocolSha256:hash('evals/matched-pipeline/model-protocol.json'),freezeSha256:hash('evals/matched-pipeline/FREEZE.json')};
 if(Date.now()>=Date.parse(grant.expiresAt))throw Error('approval_expired');
 env.STRUCTURED_MODEL_POLICY_ID='openrouter-azure-mini-zdr-text-v1';
 writeFileSync('/tmp/deep-paid-evaluation-env.json',JSON.stringify(env),{mode:0o600});
 writeFileSync(new URL('AUTHORIZATION.json',out),JSON.stringify(grant,null,2)+'\n',{flag:'wx'});
 writeFileSync(new URL('SETUP.json',out),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),quota,accountId:previous.accountId,policyId:env.STRUCTURED_MODEL_POLICY_ID,aggregateCapMicro:400000,priorAttemptCount:3,priorOperatorReconciledMicro:0,generationRequests:0},null,2)+'\n',{flag:'wx'});
 console.log('Azure route registered; same account and aggregate cap; no model request.');
}finally{await pool.end();}
