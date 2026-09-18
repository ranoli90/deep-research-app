/** Narrow operator reconciliation of this session's three completed, plugin-free HTTP404 rejections.
 * Not a general release mechanism and never applicable to a network/unknown external outcome.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPool,withTx,migrate} from '../../../apps/backend/src/platform/db.js';
import {loadConfig} from '../../../apps/backend/src/platform/config.js';
import {processRun} from '../../../apps/backend/src/worker/executor.js';
import {updateIntentState} from '../../../apps/backend/src/modules/billing.js';
import {emitEvent} from '../../../apps/backend/src/modules/runs.js';
import {readProviderQuota} from '../../../apps/backend/src/evaluation/provider-quota.js';
import {prepareModelRequest} from '../../../apps/backend/src/adapters/model/openrouter.js';
const out=new URL('./REJECTION_RECONCILIATION.json',import.meta.url);if(existsSync(out))throw Error('reconciliation_already_attempted');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const setup=JSON.parse(readFileSync(new URL('../forward-accounting/SETUP.json',import.meta.url),'utf8'));
const initial=JSON.parse(readFileSync(new URL('../forward-accounting/AUTHORIZATION.json',import.meta.url),'utf8'));
const ids=['19eb6667-a007-4a8d-ba4c-494c3b5c803b','6854ec77-2779-4f09-9f56-6a1679cd44e3','15061d78-0fb4-4b80-a3e8-23553a371e0f'];
const keyScope=createHash('sha256').update(`openrouter:${env.OPENROUTER_API_KEY.trim()}`).digest('hex');
const pool=createPool(env.DATABASE_URL);const evidence:any={version:'operator-http404-zero-usage-reconciliation.v1',commit,authorization:'User requested fixing accounting and proceeding with the capped test',intentIds:ids,policy:'https://openrouter.zendesk.com/hc/en-us/articles/51693138951451-Was-I-charged-for-a-failed-errored-or-empty-response-Zero-Completion-Insurance',scope:'Completed HTTP404 non-streaming model-only requests; no output, no plugins, unchanged same-key aggregate usage and zero daily usage. This records an operator financial decision, not invented generation receipts.',startedAt:new Date().toISOString()};
try{
 const quota=await readProviderQuota(env.OPENROUTER_API_KEY);
 if(quota.usageUsd!==setup.snapshot.quota.usageUsd||quota.usageDailyUsd!==0||!evidence.startedAt.startsWith('2026-09-18'))throw Error('provider_zero_usage_not_proven');
 if(Date.now()>=Date.parse(initial.expiresAt))throw Error('approval_expired');
 evidence.quota=quota;evidence.originalQuota=setup.snapshot.quota;
 const before=(await pool.query('SELECT id,run_id,state,confirmed_micro,receipt FROM provider_intents ORDER BY id')).rows;
 if(before.length!==ids.length||before.some(r=>!ids.includes(r.id)||r.confirmed_micro!==null||r.receipt?.httpStatus!==404||r.receipt?.providerId!==null))throw Error('unexpected_attempts');
 // Additive policy column only on the dedicated paid-evaluation database; original project DB untouched.
 await migrate(pool);
 const disabled={...loadConfig(env),openRouterApiKey:undefined,liveRouteEnabled:false,structuredModelEnabled:false};
 for(const item of before){
  const run=(await pool.query('SELECT lifecycle FROM runs WHERE id=$1',[item.run_id])).rows[0];
  if(run.lifecycle==='cancelling')await processRun(pool,disabled,item.run_id);
 }
 evidence.settlements=await withTx(pool,async db=>{
  await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[initial.accountId]);
  const results=[];
  for(const id of ids){
   const row=(await db.query(`SELECT p.*,r.lifecycle,r.account_id,r.brief_revision,r.evidence_revision,r.model_policy_id,b.original_question,m.result,m.policy_id,m.schema_version,m.prompt_version
    FROM provider_intents p JOIN runs r ON r.id=p.run_id JOIN research_briefs b ON b.id=r.brief_id
    JOIN model_operation_results m ON m.intent_id=p.id AND m.result->'receipt'=p.receipt WHERE p.id=$1 FOR UPDATE OF r,p`,[id])).rows[0];
   if(!row||row.account_id!==initial.accountId||row.lifecycle!=='terminal'||row.provider_key_scope!==keyScope||row.scope_key!==initial.budgetScope||row.confirmed_micro!==null||row.route!=='openrouter:openai/gpt-4o-mini:brief'||row.model_policy_id!=='openrouter-openai-mini-text-v1'||row.policy_id!==row.model_policy_id||row.result.status!=='permanent_failure'||!/^provider_http_404(?:_data_policy)?$/.test(row.result.reason)||row.receipt.httpStatus!==404||row.receipt.providerId!==null||row.receipt.rawCost!==null||row.receipt.actualMicro!==null||row.receipt.promptTokens!==null||row.receipt.completionTokens!==null||!row.receipt.finishedAt?.startsWith('2026-09-18'))throw Error('rejection_basis_unavailable');
   const request=prepareModelRequest('brief',{question:row.original_question,task:null,passages:[],sources:[],assertions:[],approvedClaimKeys:[],draft:null},row.model_policy_id);
   const digest=createHash('sha256').update(JSON.stringify({digest:request.digest,policy:request.policyId,schema:request.schemaVersion,prompt:request.promptVersion,brief:row.brief_revision,evidence:row.evidence_revision})).digest('hex');
   if(digest!==row.request_digest||JSON.parse(request.body).plugins.length||JSON.parse(request.body).stream!==false)throw Error('original_request_not_reproduced');
   await updateIntentState(db,id,'confirmed',0);
   await db.query("UPDATE reservations SET settlement_basis='operator_http404_zero_usage_v1' WHERE run_id=$1 AND state='settled' AND settled_micro=0",[row.run_id]);
   await emitEvent(db,{runId:row.run_id,accountId:initial.accountId,type:'financial_reconciliation',phase:'preparing',summary:'A completed routing rejection was reconciled as zero cost; the original error receipt is retained.',payload:{version:evidence.version,intentId:id,actualMicro:0,basis:'completed_plugin_free_http404_and_documented_zero_completion_policy_with_zero_key_usage',quota,originalReceiptDigest:createHash('sha256').update(JSON.stringify(row.receipt)).digest('hex')}});
   results.push({intentId:id,actualMicro:0,originalReceiptUnchanged:true,requestDigest:digest});
  }
  return results;
 });
 evidence.after=(await pool.query('SELECT id,state,confirmed_micro,receipt FROM provider_intents ORDER BY id')).rows;
 evidence.account=(await pool.query('SELECT limit_micro,reserved_micro,settled_micro FROM allowance_accounts WHERE account_id=$1',[initial.accountId])).rows[0];
 evidence.exitCode=0;
}catch(error){evidence.exitCode=1;evidence.reason=error instanceof Error?error.message:'unclassified';process.exitCode=1;}
finally{await pool.end();writeFileSync(out,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({exitCode:evidence.exitCode,reason:evidence.reason,settlements:evidence.settlements,account:evidence.account}));}
