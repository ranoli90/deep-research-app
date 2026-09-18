/** Read only this project's local financial metadata. Never exports a credential or account record. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createPool} from '../../../apps/backend/src/platform/db.js';
const env=Object.fromEntries(readFileSync(new URL('../../../.env',import.meta.url),'utf8').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const result:Record<string,unknown>={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),command:'pnpm --filter @deep/backend exec tsx /home/oranolio/Desktop/Deep/verification/v6/paid-readiness/inspect-route-provenance.mts',checkedAt:new Date().toISOString(),scope:'read-only configured local project database, current-key and unattributed financial metadata only; no authorization inferred',paidCostMicro:0};
let pool:ReturnType<typeof createPool>|undefined;
try{
 const url=new URL(env.DATABASE_URL??'');if(!['localhost','127.0.0.1','::1'].includes(url.hostname)||!env.OPENROUTER_API_KEY)throw Error('configured_local_database_or_project_key_unavailable');
 pool=createPool(url.toString());
 const keyScope=createHash('sha256').update(`openrouter:${env.OPENROUTER_API_KEY.trim()}`).digest('hex');
 const rows=(await pool.query(`SELECT route,state,COUNT(*)::int AS intents,COALESCE(SUM(confirmed_micro),0)::text AS confirmed_micro,COALESCE(SUM(reserved_max_micro) FILTER(WHERE confirmed_micro IS NULL),0)::text AS held_micro,MIN(created_at) AS earliest,MAX(created_at) AS latest FROM provider_intents GROUP BY route,state ORDER BY route,state`)).rows;
 result.status='metadata_received';result.exposure=rows;result.exitCode=0;
}catch(error){const code=(error as {code?:unknown}).code;result.status='metadata_unavailable';result.reason=typeof code==='string'&&['ECONNREFUSED','ETIMEDOUT','28P01','3D000','42P01','42703'].includes(code)?code:error instanceof Error&&error.message==='configured_local_database_or_project_key_unavailable'?error.message:'unclassified_metadata_failure';result.exitCode=1;if(code==='42703'&&pool){result.availableLedgerColumns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_intents' ORDER BY ordinal_position")).rows.map(r=>r.column_name);
 result.legacyUnattributedExposure=(await pool.query(`SELECT CASE WHEN route LIKE 'openrouter%' THEN 'openrouter' ELSE 'other_route' END AS route_class,COUNT(*)::int AS intents,COALESCE(SUM(confirmed_micro),0)::text AS confirmed_micro,COUNT(*) FILTER(WHERE confirmed_micro IS NULL)::int AS unconfirmed_intents,COALESCE(SUM(reserved_max_micro) FILTER(WHERE confirmed_micro IS NULL),0)::text AS held_micro FROM provider_intents GROUP BY route_class`)).rows;
 }}
finally{await pool?.end();}
writeFileSync(new URL('./PROJECT_ROUTE_PROVENANCE.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));process.exitCode=Number(result.exitCode);
