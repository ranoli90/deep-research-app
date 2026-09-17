import type { Queryable } from "../platform/db.js";
import { bumpEvidence } from "./runs.js";
/** Caller holds the account/admission lock. Copy membership, never source bytes or old approvals. */
export async function inheritRunEvidence(db:Queryable,args:{runId:string;parentRunId:string;accountId:string}) {
 const owned=await db.query(`SELECT c.id FROM runs c JOIN runs p ON p.id=c.parent_run_id JOIN accounts a ON a.id=c.account_id
  WHERE c.id=$1 AND p.id=$2 AND c.account_id=$3 AND p.account_id=$3 AND a.deleted_at IS NULL AND c.lifecycle='queued'`,[args.runId,args.parentRunId,args.accountId]);
 if(owned.rowCount!==1)throw new Error("evidence_inheritance_owner_or_state_mismatch");
 const inserted=await db.query(`INSERT INTO run_evidence_membership(run_id,account_id,passage_id,source_version_id,origin_run_id,passage_digest,version_digest)
  SELECT $1,$3,p.id,p.source_version_id,original.run_id,p.content_hash,v.content_hash
  FROM authorized_run_passages p JOIN passages original ON original.id=p.id JOIN source_versions v ON v.id=p.source_version_id
  WHERE p.run_id=$2 AND p.account_id=$3 AND v.access_level IN ('partial-text','full-text') AND v.content_hash IS NOT NULL
  ON CONFLICT DO NOTHING RETURNING passage_id`,[args.runId,args.parentRunId,args.accountId]);
 if(inserted.rowCount)await bumpEvidence(db,args.runId);
 return inserted.rowCount??0;
}
