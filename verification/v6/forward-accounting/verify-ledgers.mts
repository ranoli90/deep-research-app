import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPool} from '../../../apps/backend/src/platform/db.js';
import {readProviderQuota} from '../../../apps/backend/src/evaluation/provider-quota.js';
const values=Object.fromEntries(readFileSync(new URL('../../../.env',import.meta.url),'utf8').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const privateEnv=JSON.parse(readFileSync('/tmp/deep-paid-evaluation-env.json','utf8'));
const before=JSON.parse(readFileSync(new URL('./SETUP.json',import.meta.url),'utf8'));
const legacy=createPool(values.DATABASE_URL!),active=createPool(privateEnv.DATABASE_URL);
try{
 const rows=(await legacy.query("SELECT p.*,r.lifecycle FROM provider_intents p JOIN runs r ON r.id=p.run_id WHERE p.route LIKE 'openrouter:%' ORDER BY p.id")).rows;
 const digest=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 const newExposure=(await active.query("SELECT count(*)::int intents,coalesce(sum(confirmed_micro),0)::text confirmed_micro,coalesce(sum(reserved_max_micro) FILTER(WHERE confirmed_micro IS NULL),0)::text held_micro,count(*) FILTER(WHERE confirmed_micro IS NULL)::int unknown FROM provider_intents")).rows[0];
 const quota=await readProviderQuota(privateEnv.OPENROUTER_API_KEY);
 const result={checkedAt:new Date().toISOString(),historicalLedgerUnchanged:digest===before.snapshot.ledgerDigest,historicalDigest:digest,newExposure,quota,scope:'Read-only preservation and financial evidence; unchanged aggregate usage is not an individual settlement.'};
 writeFileSync(new URL('./FINAL_LEDGER_CHECK.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!result.historicalLedgerUnchanged)process.exitCode=1;
}finally{await legacy.end();await active.end();}
