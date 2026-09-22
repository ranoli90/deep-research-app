/** Read-only actual generation metadata and current key usage; never infers unknown-attempt settlement. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createPool} from '../../../apps/backend/src/platform/db.js';
import {lookupGenerationReceipt} from '../../../apps/backend/src/adapters/model/generation-receipt.js';
import {readProviderQuota} from '../../../apps/backend/src/evaluation/provider-quota.js';
const env=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8')),pool=createPool(env.DATABASE_URL);
try{
 const rows=(await pool.query('SELECT id,state,reserved_max_micro,confirmed_micro,receipt FROM provider_intents ORDER BY id')).rows;
 const lookups=[];
 for(const r of rows)if(r.receipt?.providerId)lookups.push({intentId:r.id,result:await lookupGenerationReceipt({providerId:r.receipt.providerId,apiKey:env.OPENROUTER_API_KEY,signal:new AbortController().signal})});
 const result={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checkedAt:new Date().toISOString(),quota:await readProviderQuota(env.OPENROUTER_API_KEY),lookups,intents:rows,mutations:0,unknownsNotReconciled:true};
 writeFileSync(new URL('./COST_CHECK.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({lookups,quota:result.quota,mutations:0}));
}finally{await pool.end();}
