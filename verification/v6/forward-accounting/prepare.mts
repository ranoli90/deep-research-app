/** One-use, explicitly authorized local evaluation setup. Never migrates or edits the historical database. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createPool,migrate,withTx} from '../../../apps/backend/src/platform/db.js';
import {createDevSession,grantConsent} from '../../../apps/backend/src/modules/access.js';
import {createQueue} from '../../../apps/backend/src/adapters/queue.js';
import {readProviderQuota,requireProviderCapacity} from '../../../apps/backend/src/evaluation/provider-quota.js';
const root=new URL('../../../',import.meta.url),out=new URL('./',import.meta.url);
const values=Object.fromEntries(readFileSync(new URL('.env',root),'utf8').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const url=new URL(values.DATABASE_URL??'');if(!['localhost','127.0.0.1','::1'].includes(url.hostname))throw Error('local_database_required');
const quota=await readProviderQuota(values.OPENROUTER_API_KEY??'');requireProviderCapacity(quota,400000);
const legacy=createPool(url.toString());
let snapshot:unknown;
try{
 const columns=(await legacy.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_intents' ORDER BY ordinal_position")).rows.map(r=>r.column_name);
 if(columns.includes('action_id')||columns.includes('provider_key_scope'))throw Error('modern_ledger_requires_existing_reconciliation');
 const rows=(await legacy.query("SELECT p.*,r.lifecycle FROM provider_intents p JOIN runs r ON r.id=p.run_id WHERE p.route LIKE 'openrouter:%' ORDER BY p.id")).rows;
 if(!rows.length||rows.some(r=>r.state!=='confirmed'||r.lifecycle!=='terminal'))throw Error('historical_external_outcome_or_active_work_unresolved');
 snapshot={version:'historical-completed-estimates.v1',rows:rows.length,allHistoricalStatesConfirmed:true,allAssociatedRunsTerminal:true,unattributedAmounts:rows.filter(r=>r.confirmed_micro===null).length,estimatedUnattributedMicro:rows.filter(r=>r.confirmed_micro===null).reduce((s,r)=>s+Number(r.reserved_max_micro),0),ledgerDigest:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),columns,recordsModified:0,individualCostsReconciled:false,holdsReleased:0,quota};
 // New explicit spending period, not a replay/migration/release of any historical action.
 const name=`deep_paid_${randomUUID().replaceAll('-','')}`;
 await legacy.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;
 const pool=createPool(url.toString());let boss:Awaited<ReturnType<typeof createQueue>>|undefined;
 try{
  await migrate(pool);boss=await createQueue(url.toString());
  const session=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);await db.query('UPDATE allowance_accounts SET limit_micro=400000 WHERE account_id=$1',[a.accountId]);return a;});
  const approvalId=randomUUID();const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex');
  const grant={version:'matched-evaluation-authorization.v1',approvalId,approvalReference:'user-20260918-fix-forward-accounting',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+4*3600000).toISOString(),protocolSha256:hash('evals/matched-pipeline/model-protocol.json'),freezeSha256:hash('evals/matched-pipeline/FREEZE.json'),taskIds:['MC-D01'],budgetMicro:400000,accountId:session.accountId,budgetScope:`evaluation:${approvalId}`,sourceMode:'frozen_supplied_document',exclusiveDatabaseAcknowledged:true};
  writeFileSync(new URL('AUTHORIZATION.json',out),JSON.stringify(grant,null,2)+'\n',{flag:'wx'});
  // Private local launcher environment, never a repository artifact or console output.
  const env={DATABASE_URL:url.toString(),EVAL_SESSION_TOKEN:session.token,OPENROUTER_API_KEY:values.OPENROUTER_API_KEY,NODE_ENV:'development',APP_AUTH_MODE:'development',DEV_ALLOW_FIXTURE_ROUTE:'false',LIVE_ROUTE_ENABLED:'true',STRUCTURED_MODEL_ENABLED:'true',STRUCTURED_DISCOVERY_ENABLED:'false',LIVE_RETRIEVAL_ENABLED:'false',LIVE_SPEND_CAP_MICRO:'400000',LIVE_KEY_SPEND_CAP_MICRO:'400000',LIVE_BUDGET_SCOPE:grant.budgetScope,OPENROUTER_MODEL:'openai/gpt-4o-mini',EXTRACTION_RUNTIME:'/tmp/deep-v6-extraction-runtime',STORAGE_DIR:`/tmp/${name}-storage`};
  writeFileSync('/tmp/deep-paid-evaluation-env.json',JSON.stringify(env),{flag:'wx',mode:0o600});
  writeFileSync(new URL('SETUP.json',out),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),command:'pnpm --filter @deep/backend exec tsx /home/oranolio/Desktop/Deep/verification/v6/forward-accounting/prepare.mts',snapshot,database:name,accountId:session.accountId,approvalId,generationRequests:0,scope:'Explicitly authorized new $0.40 period; historical completed cost estimates preserved without claiming individual reconciliation'},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,database:name,accountId:session.accountId,approvalId,generationRequests:0}));
 }finally{await boss?.stop({graceful:false,timeout:2000});await pool.end();}
}finally{await legacy.end();}
