import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const {Pool}=createRequire(process.cwd()+'/apps/backend/package.json')('pg');
const pool=new Pool({connectionString:'postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_native_v6'});
const owner='b19e0195-b244-4e7c-ad43-a6d952441d7e';
const queries={
 runs:`SELECT r.id,r.parent_run_id,r.lifecycle,r.terminal_outcome,r.route_mode,r.created_at,r.updated_at,r.spent_micro,b.original_question FROM runs r JOIN research_briefs b ON b.id=r.brief_id WHERE r.account_id=$1 ORDER BY r.created_at`,
 reports:`SELECT id,run_id,outcome,blocks,change_summary,published_at,redacted_at FROM reports WHERE account_id=$1 ORDER BY published_at`,
 sources:`SELECT s.id,s.run_id,s.title,v.id version_id,v.content_hash,v.access_level,v.text_coverage FROM sources s JOIN source_versions v ON v.source_id=s.id WHERE s.account_id=$1 ORDER BY s.created_at`,
 passages:`SELECT id,run_id,source_version_id,exact_text,locator,extraction_method,content_hash FROM passages WHERE account_id=$1 ORDER BY run_id,id`,
 reads:`SELECT run_id,source_id,reader_version,state,source_version_id FROM source_read_operations WHERE account_id=$1 ORDER BY run_id,source_id`,
 reuse:`SELECT run_id,passage_id,source_version_id,origin_run_id,passage_digest,version_digest FROM run_evidence_membership WHERE account_id=$1 ORDER BY run_id,passage_id`,
 intents:`SELECT state,count(*)::int count FROM provider_intents WHERE run_id IN (SELECT id FROM runs WHERE account_id=$1) GROUP BY state`,
 account:`SELECT id,deleted_at FROM accounts WHERE id=$1`
};
try{
 const out={evidenceClass:'native UI / actual local API-worker-PDF-parser / fabricated model',paidCalls:0,accountId:owner,capturedAt:new Date().toISOString()};
 await pool.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 for(const [key,sql] of Object.entries(queries))out[key]=(await pool.query(sql,[owner])).rows;
 await pool.query('COMMIT');
 const path=process.argv[2]; if(!/^verification\/v6\/physical-unlocked\/[a-z-]+\.json$/.test(path??''))throw Error('Expected bounded evidence path');
 writeFileSync(path,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({artifact:path,runs:out.runs.length,reports:out.reports.length,reads:out.reads.length,reuse:out.reuse.length,intents:out.intents}));
}finally{await pool.end();}
