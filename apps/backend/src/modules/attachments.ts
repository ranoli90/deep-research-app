import { createHash } from "node:crypto";
import type pg from "pg";
import { withTx } from "../platform/db.js";

/** Bytes and metadata commit under the same account lock used by deletion. No disk orphan window. */
export async function storeAttachment(pool: pg.Pool, args: {
  accountId: string; filename: string; mime: string; bytes: Buffer; extractedText: string;
}): Promise<string | null> {
  return withTx(pool, async (db) => {
    const active = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [args.accountId]);
    if (!active.rows[0]) return null;
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO attachments
      (id,account_id,filename,mime,size_bytes,storage_ptr,sha256,processing_state,extracted_text,raw_bytes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'extracted',$8,$9)`,
    [id, args.accountId, args.filename, args.mime, args.bytes.length, `db:${id}`,
      createHash("sha256").update(args.bytes).digest("hex"), args.extractedText, args.bytes]);
    return id;
  });
}
