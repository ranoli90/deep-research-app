import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type pg from "pg";
import { withTx } from "../platform/db.js";

/** Only the exact server-generated flat key is deletable; a stored pointer grants no filesystem authority. */
export function legacyAttachmentPath(root: string, accountId: string, attachmentId: string, pointer: string): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(accountId) || !uuid.test(attachmentId)) return null;
  const expected = resolve(root, `${accountId}-${attachmentId}`);
  return resolve(pointer) === expected ? join(resolve(root), `${accountId}-${attachmentId}`) : null;
}

/** Commit the claim before touching storage. Retry lost acks; ENOENT is successful idempotent deletion. */
export async function drainFileDeletions(pool: pg.Pool, storageDir: string, accountId?: string, limit = 20): Promise<number> {
  const attempt = crypto.randomUUID();
  const rows = await withTx(pool, (db) => db.query<{ attachment_id: string; account_id: string; storage_ptr: string }>(`
    WITH pending AS (
      SELECT attachment_id FROM file_deletion_outbox
      WHERE state <> 'deleted' AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
        AND ($2::uuid IS NULL OR account_id=$2)
      ORDER BY next_attempt_at,attachment_id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE file_deletion_outbox d SET state='deleting',attempt_id=$3,attempts=attempts+1,
      lease_until=now()+interval '30 seconds'
    FROM pending WHERE d.attachment_id=pending.attachment_id RETURNING d.attachment_id,d.account_id,d.storage_ptr`,
  [limit, accountId ?? null, attempt]));
  let removed = 0;
  for (const row of rows.rows) {
    const path = legacyAttachmentPath(storageDir, row.account_id, row.attachment_id, row.storage_ptr);
    let error: "unsafe_storage_pointer" | "storage_unavailable" | null = path ? null : "unsafe_storage_pointer";
    if (path) {
      try { await unlink(path); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") error = "storage_unavailable"; }
    }
    const result = await pool.query(`UPDATE file_deletion_outbox SET state=$3,lease_until=NULL,last_error=$4,
      storage_ptr=CASE WHEN $4::text IS NULL THEN '' ELSE storage_ptr END,
      deleted_at=CASE WHEN $4::text IS NULL THEN now() ELSE NULL END,
      next_attempt_at=now()+interval '30 seconds'
      WHERE attachment_id=$1 AND attempt_id=$2`, [row.attachment_id, attempt, error ? "pending" : "deleted", error]);
    if (!error) removed += result.rowCount ?? 0;
  }
  return removed;
}
