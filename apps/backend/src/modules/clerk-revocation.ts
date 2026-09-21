import type pg from "pg";
import type { VerifiedClerkWebhookEvent } from "../adapters/auth/clerk-webhook.js";
import { withTx } from "../platform/db.js";
import { deleteAccount } from "./access.js";
import { identityDigest } from "./identity.js";

/** Durable verified-event application. No webhook creates an account or grants allowance. */
export async function applyClerkWebhookEvent(
  pool: pg.Pool, event: VerifiedClerkWebhookEvent,
): Promise<{ reused: boolean }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(event.eventId) ||
      !/^[a-f0-9]{64}$/.test(event.payloadDigest) ||
      !["user.created", "user.updated", "user.deleted", "session.ended", "session.revoked"].includes(event.kind))
    throw new Error("clerk_webhook_event_invalid");
  const userEvent = event.kind.startsWith("user.");
  if ((userEvent && (!event.subject || !/^user_[A-Za-z0-9]+$/.test(event.subject) || event.sessionId)) ||
      (!userEvent && (!event.sessionId || !/^sess_[A-Za-z0-9]+$/.test(event.sessionId))))
    throw new Error("clerk_webhook_event_invalid");

  return withTx(pool, async (db) => {
    // Login mapping and deletion share this identity lock, so a queued callback
    // cannot insert an account between tombstone creation and local fanout.
    const digest = event.kind === "user.deleted" ? identityDigest(event.issuer, event.subject!) : null;
    if (digest) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`identity:${digest}`]);
    const inserted = await db.query(`INSERT INTO clerk_webhook_receipts(event_id,payload_digest,kind)
      VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [event.eventId, event.payloadDigest, event.kind]);
    if (!inserted.rowCount) {
      const existing = await db.query<{ payload_digest: string; kind: string }>(
        "SELECT payload_digest,kind FROM clerk_webhook_receipts WHERE event_id=$1", [event.eventId]);
      if (existing.rows[0]?.payload_digest !== event.payloadDigest || existing.rows[0]?.kind !== event.kind)
        throw new Error("clerk_webhook_replay_mismatch");
      return { reused: true };
    }

    if (digest) {
      await db.query(`INSERT INTO clerk_deleted_subjects(identity_digest,provider_event_id)
        VALUES ($1,$2) ON CONFLICT (identity_digest) DO NOTHING`, [digest, event.eventId]);
      const mapped = await db.query<{ account_id: string }>(
        "SELECT account_id FROM external_identities WHERE identity_digest=$1", [digest]);
      if (mapped.rows[0]) await deleteAccount(db, mapped.rows[0].account_id);
    } else if (event.sessionId) {
      await db.query(`INSERT INTO clerk_revoked_sessions(session_id,provider_event_id)
        VALUES ($1,$2) ON CONFLICT (session_id) DO NOTHING`, [event.sessionId, event.eventId]);
    }
    // user.created/updated are receipts only. They cannot resurrect an identity.
    return { reused: false };
  });
}
