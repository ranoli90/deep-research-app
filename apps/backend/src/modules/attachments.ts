import { createHash } from "node:crypto";
import type pg from "pg";
import { MAX_ATTACHMENT_BYTES } from "@deep/contracts";
import { ExtractedDocument } from "../adapters/extraction/offline.js";
import { withTx } from "../platform/db.js";

/** Bytes and metadata commit under the same account lock used by deletion. No disk orphan window. */
export async function storeAttachment(pool: pg.Pool, args: {
  accountId: string; filename: string; mime: string; bytes: Buffer; extractedText?: string;
}): Promise<string | null> {
  if (args.extractedText !== undefined && !Buffer.from(args.extractedText, "utf8").equals(args.bytes)) throw new Error("attachment_text_byte_mismatch");
  const digest = createHash("sha256").update(args.bytes).digest("hex");
  const extraction = args.extractedText !== undefined && ["text/plain", "text/markdown"].includes(args.mime)
    ? ExtractedDocument.parse({ version: "utf8-notes-v1", digest, status: "extracted", warnings: [],
      blocks: [{ kind: "text", locator: "paragraph:0", text: args.extractedText, rows: [] }] }) : null;
  return withTx(pool, async (db) => {
    const active = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [args.accountId]);
    if (!active.rows[0]) return null;
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO attachments
      (id,account_id,filename,mime,size_bytes,storage_ptr,sha256,processing_state,extracted_text,raw_bytes,extraction)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, args.accountId, args.filename, args.mime, args.bytes.length, `db:${id}`,
      digest, extraction ? "extracted" : "stored", extraction ? args.extractedText : null, args.bytes, extraction ? JSON.stringify(extraction) : null]);
    return id;
  });
}

/** Magic and UTF-8 checks establish input class, not successful parsing. Paths are never accepted. */
export function validateAttachmentBytes(bytes: Buffer, mime: string, filename: string): void {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("invalid_attachment_size");
  if (!filename || filename.length > 180 || /[\\/\x00-\x1f\x7f]/.test(filename)) throw new Error("invalid_attachment_name");
  if (mime === "application/pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("pdf_bytes_required");
  } else if (["text/plain", "text/markdown"].includes(mime)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || text.startsWith("%PDF-")) throw new Error("invalid_text_bytes");
  } else throw new Error("unsupported_attachment_mime");
}
