/** Exact synthetic account cleanup after harness SIGTERM exited143 before its async stop hook. */
import { createPool } from '../../../apps/backend/src/platform/db.js';
import { deleteAccount } from '../../../apps/backend/src/modules/access.js';
const pool=createPool('postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_native_v6');
const id='e0d15986-772f-445e-bedc-93981616e54f';
try {
 const {rows}=await pool.query('SELECT id,created_at,deleted_at FROM accounts WHERE id=$1',[id]);
 if(rows.length!==1||new Date(rows[0].created_at).toISOString()!=='2026-09-18T11:43:28.099Z')throw Error('Synthetic account identity mismatch');
 const runs=await pool.query('SELECT count(*)::int n FROM runs WHERE account_id=$1',[id]);
 if(runs.rows[0].n!==0)throw Error('Unexpected account data; review required');
 await deleteAccount(pool,id);
 const result=await pool.query("SELECT (SELECT count(*) FROM accounts WHERE deleted_at IS NULL) active_accounts,(SELECT count(*) FROM runs) retained_runs,(SELECT count(*) FROM provider_intents WHERE state<>'confirmed') unconfirmed_intents,(SELECT count(*) FROM attachments WHERE raw_bytes IS NOT NULL OR COALESCE(extracted_text,'')<>'') attachment_content");
 console.log(JSON.stringify({operation:'exact_owned_synthetic_account_cleanup',accountId:id,result:result.rows[0],paidCalls:0}));
}finally{await pool.end();}
