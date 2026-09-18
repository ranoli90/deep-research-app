import { createHash } from "node:crypto";
import type pg from "pg";
import { MAX_ATTACHMENT_BYTES, MAX_FETCH_BYTES } from "@deep/contracts";
import { ExtractedDocument } from "../adapters/extraction/offline.js";
import { withTx } from "../platform/db.js";

export class AttachmentUploadConflict extends Error {
  constructor() { super("attachment_upload_conflict"); }
}

/** An upload acknowledgement reflects owned stored evidence, including later parser results. */
export async function attachmentUploadReceipt(pool: pg.Pool, accountId: string, id: string) {
  const row = (await pool.query(`SELECT a.id,a.processing_state,a.sha256,a.extraction FROM attachments a
    JOIN accounts owner ON owner.id=a.account_id AND owner.deleted_at IS NULL
    WHERE a.id=$1 AND a.account_id=$2 AND a.deleted_at IS NULL`, [id,accountId])).rows[0];
  if (!row) return null;
  const parsed = ExtractedDocument.safeParse(row.extraction);
  const coverage = row.extraction === null ? "not-read" : !parsed.success || parsed.data.digest !== row.sha256 ? "unavailable"
    : parsed.data.status === "extracted" ? "complete" : parsed.data.status;
  return { attachmentId: row.id as string, processingState: row.processing_state as string, coverage };
}

/** Bytes and metadata commit under the same account lock used by deletion. No disk orphan window. */
export async function storeAttachment(pool: pg.Pool, args: {
  accountId: string; filename: string; mime: string; bytes: Buffer; extractedText?: string; idempotencyKey?: string;
}): Promise<string | null> {
  if (args.idempotencyKey !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.idempotencyKey))
    throw new Error("invalid_attachment_idempotency_key");
  const keyHash = args.idempotencyKey === undefined ? null : createHash("sha256").update(args.idempotencyKey.toLowerCase()).digest("hex");
  if (args.extractedText !== undefined && !Buffer.from(args.extractedText, "utf8").equals(args.bytes)) throw new Error("attachment_text_byte_mismatch");
  const digest = createHash("sha256").update(args.bytes).digest("hex");
  const extraction = args.extractedText !== undefined && ["text/plain", "text/markdown"].includes(args.mime)
    ? ExtractedDocument.parse({ version: "utf8-notes-v1", digest, status: "extracted", warnings: [],
      blocks: [{ kind: "text", locator: "paragraph:0", text: args.extractedText, rows: [] }] }) : null;
  return withTx(pool, async (db) => {
    const active = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [args.accountId]);
    if (!active.rows[0]) return null;
    if (keyHash) {
      const existing = (await db.query(`SELECT id,filename,mime,size_bytes,sha256,deleted_at FROM attachments
        WHERE account_id=$1 AND upload_key_hash=$2`, [args.accountId,keyHash])).rows[0];
      if (existing) {
        if (existing.deleted_at || existing.filename !== args.filename || existing.mime !== args.mime ||
          Number(existing.size_bytes) !== args.bytes.length || existing.sha256 !== digest) throw new AttachmentUploadConflict();
        return existing.id as string;
      }
    }
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO attachments
      (id,account_id,filename,mime,size_bytes,storage_ptr,sha256,processing_state,extracted_text,raw_bytes,extraction,upload_key_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, args.accountId, args.filename, args.mime, args.bytes.length, `db:${id}`,
      digest, extraction ? "extracted" : "stored", extraction ? args.extractedText : null, args.bytes, extraction ? JSON.stringify(extraction) : null,keyHash]);
    return id;
  });
}

/** Magic and UTF-8 checks establish input class, not successful parsing. Paths are never accepted. */
export function validateAttachmentBytes(bytes: Buffer, mime: string, filename: string): void {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("invalid_attachment_size");
  // Saved pages use the same bound and isolated parser as fetched HTML.
  if (mime === "text/html" && bytes.length > MAX_FETCH_BYTES) throw new Error("invalid_attachment_size");
  if (!filename || filename.length > 180 || /[\\/\x00-\x1f\x7f]/.test(filename)) throw new Error("invalid_attachment_name");
  if (mime === "application/pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("pdf_bytes_required");
  } else if (["text/plain", "text/markdown", "text/html"].includes(mime)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || text.startsWith("%PDF-")) throw new Error("invalid_text_bytes");
  } else throw new Error("unsupported_attachment_mime");
}
