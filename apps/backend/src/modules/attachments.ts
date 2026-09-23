import { createHash } from "node:crypto";
import type pg from "pg";
import { MAX_ATTACHMENT_BYTES, MAX_FETCH_BYTES } from "@deep/contracts";
import { ExtractedDocument } from "../adapters/extraction/offline.js";
import type { AppConfig } from "../platform/config.js";
import { withTx, type Queryable } from "../platform/db.js";

export class AttachmentUploadConflict extends Error {
  constructor() { super("attachment_upload_conflict"); }
}

/** R12: a quota/rate denial. The public boundary maps this to one denial code. */
export class AttachmentStorageDenied extends Error {
  constructor(readonly reason: "account_bytes" | "account_objects" | "admission_rate" | "global_bytes" | "global_objects") {
    super("storage_quota_exceeded");
  }
}

type AttachmentQuotaConfig = Pick<AppConfig,
  "attachmentAccountByteQuota" | "attachmentAccountObjectQuota" | "attachmentAdmissionLimit" |
  "attachmentAdmissionWindowMs" | "attachmentGlobalByteQuota" | "attachmentGlobalObjectQuota" |
  "attachmentReservationTtlMs">;

export type AttachmentReservation = { id: string; reused: boolean };

const ADMISSION_GLOBAL_LOCK = "attachment-storage-global-exposure";

function uploadKeyHash(idempotencyKey: string | undefined): string | null {
  return idempotencyKey === undefined ? null : createHash("sha256").update(idempotencyKey.toLowerCase()).digest("hex");
}

function integer(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reserve storage before any bytes are written. Serialized per account by the
 * account row lock and across accounts by an advisory lock, so concurrent unique
 * uploads cannot oversubscribe the same quota. An idempotent replay reuses its
 * live reservation and never double-reserves.
 */
export async function reserveAttachmentUpload(pool: pg.Pool, config: AttachmentQuotaConfig,
  args: { accountId: string; sizeBytes: number; idempotencyKey?: string }): Promise<AttachmentReservation> {
  if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0) throw new AttachmentStorageDenied("account_bytes");
  const keyHash = uploadKeyHash(args.idempotencyKey);
  return withTx(pool, async (db) => {
    const active = await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [args.accountId]);
    if (!active.rows[0]) throw Object.assign(new Error("permission_denied"), { statusCode: 401 });
    await expireAbandonedAttachmentReservations(db, args.accountId, 200);
    if (keyHash) {
      const existing = (await db.query<{ id: string }>(`SELECT id FROM attachment_storage_reservations
        WHERE account_id=$1 AND upload_key_hash=$2 AND state IN ('reserved','settled')`, [args.accountId, keyHash])).rows[0];
      if (existing) return { id: existing.id, reused: true };
    }
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ADMISSION_GLOBAL_LOCK]);
    const accountCommitted = (await db.query<{ bytes: string; objects: string }>(`SELECT
      COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
      FROM attachments WHERE account_id=$1 AND deleted_at IS NULL`, [args.accountId])).rows[0]!;
    const accountReserved = (await db.query<{ bytes: string; objects: string }>(`SELECT
      COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
      FROM attachment_storage_reservations
      WHERE account_id=$1 AND state='reserved' AND expires_at > now()`, [args.accountId])).rows[0]!;
    const globalCommitted = (await db.query<{ bytes: string; objects: string }>(`SELECT
      COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
      FROM attachments WHERE deleted_at IS NULL`)).rows[0]!;
    const globalReserved = (await db.query<{ bytes: string; objects: string }>(`SELECT
      COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
      FROM attachment_storage_reservations
      WHERE state='reserved' AND expires_at > now()`)).rows[0]!;
    const admissions = (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n
      FROM attachment_storage_reservations
      WHERE account_id=$1 AND admitted_at > now() - make_interval(secs => $2)`,
      [args.accountId, config.attachmentAdmissionWindowMs / 1000])).rows[0]!;
    if (integer(admissions.n) >= config.attachmentAdmissionLimit) throw new AttachmentStorageDenied("admission_rate");
    if (integer(accountCommitted.bytes) + integer(accountReserved.bytes) + args.sizeBytes > config.attachmentAccountByteQuota)
      throw new AttachmentStorageDenied("account_bytes");
    if (integer(accountCommitted.objects) + integer(accountReserved.objects) + 1 > config.attachmentAccountObjectQuota)
      throw new AttachmentStorageDenied("account_objects");
    if (integer(globalCommitted.bytes) + integer(globalReserved.bytes) + args.sizeBytes > config.attachmentGlobalByteQuota)
      throw new AttachmentStorageDenied("global_bytes");
    if (integer(globalCommitted.objects) + integer(globalReserved.objects) + 1 > config.attachmentGlobalObjectQuota)
      throw new AttachmentStorageDenied("global_objects");
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO attachment_storage_reservations
      (id,account_id,upload_key_hash,size_bytes,state,expires_at) VALUES ($1,$2,$3,$4,'reserved',$5)`,
    [id, args.accountId, keyHash, args.sizeBytes, new Date(Date.now() + config.attachmentReservationTtlMs)]);
    return { id, reused: false };
  });
}

/** Settle a reservation into committed storage in the same transaction as its bytes. Idempotent. */
export async function settleAttachmentReservation(db: Queryable, reservationId: string, attachmentId: string): Promise<void> {
  await db.query(`UPDATE attachment_storage_reservations SET state='settled',attachment_id=$2,settled_at=now()
    WHERE id=$1 AND state IN ('reserved','released')`, [reservationId, attachmentId]);
}

/** Release a reservation whose bytes were never committed. Only a live reservation is released. */
export async function releaseAttachmentReservation(pool: pg.Pool, reservationId: string): Promise<void> {
  await pool.query(`UPDATE attachment_storage_reservations SET state='released',settled_at=now()
    WHERE id=$1 AND state='reserved'`, [reservationId]);
}

/** Reclaim abandoned uploads for an account. Expired reservations already stop counting before this runs. */
export async function expireAbandonedAttachmentReservations(db: Queryable, accountId: string, limit = 200): Promise<number> {
  const result = await db.query(`UPDATE attachment_storage_reservations SET state='expired',settled_at=now()
    WHERE id IN (SELECT id FROM attachment_storage_reservations
      WHERE account_id=$1 AND state='reserved' AND expires_at < now() ORDER BY expires_at LIMIT $2)`,
  [accountId, limit]);
  return result.rowCount ?? 0;
}

/** Read-back of committed plus live reserved usage; used for observability and tests. */
export async function attachmentStorageUsage(db: Queryable, accountId: string): Promise<{
  committedBytes: number; committedObjects: number; reservedBytes: number; reservedObjects: number;
}> {
  const committed = (await db.query<{ bytes: string; objects: string }>(`SELECT
    COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
    FROM attachments WHERE account_id=$1 AND deleted_at IS NULL`, [accountId])).rows[0]!;
  const reserved = (await db.query<{ bytes: string; objects: string }>(`SELECT
    COALESCE(SUM(size_bytes),0)::bigint AS bytes, COUNT(*)::int AS objects
    FROM attachment_storage_reservations
    WHERE account_id=$1 AND state='reserved' AND expires_at > now()`, [accountId])).rows[0]!;
  return { committedBytes: integer(committed.bytes), committedObjects: integer(committed.objects),
    reservedBytes: integer(reserved.bytes), reservedObjects: integer(reserved.objects) };
}

/** Global committed plus live reserved exposure; used for observability and tests. */
export async function attachmentStorageExposure(db: Queryable): Promise<{ committedBytes: number; reservedBytes: number }> {
  const committed = (await db.query<{ bytes: string }>(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS bytes
    FROM attachments WHERE deleted_at IS NULL`)).rows[0]!;
  const reserved = (await db.query<{ bytes: string }>(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS bytes
    FROM attachment_storage_reservations WHERE state='reserved' AND expires_at > now()`)).rows[0]!;
  return { committedBytes: integer(committed.bytes), reservedBytes: integer(reserved.bytes) };
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
  reservationId?: string;
}): Promise<string | null> {
  if (args.idempotencyKey !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.idempotencyKey))
    throw new Error("invalid_attachment_idempotency_key");
  const keyHash = uploadKeyHash(args.idempotencyKey);
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
        if (args.reservationId) await settleAttachmentReservation(db, args.reservationId, existing.id as string);
        return existing.id as string;
      }
    }
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO attachments
      (id,account_id,filename,mime,size_bytes,storage_ptr,sha256,processing_state,extracted_text,raw_bytes,extraction,upload_key_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, args.accountId, args.filename, args.mime, args.bytes.length, `db:${id}`,
      digest, extraction ? "extracted" : "stored", extraction ? args.extractedText : null, args.bytes, extraction ? JSON.stringify(extraction) : null,keyHash]);
    if (args.reservationId) await settleAttachmentReservation(db, args.reservationId, id);
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
