import { createHash } from "node:crypto";
import type pg from "pg";
import type { VerifiedIdentity } from "../adapters/auth/supabase.js";
import { withTx } from "../platform/db.js";

/** Provider subject/issuer are trusted only after the auth adapter succeeds. Email never joins accounts. */
export function identityDigest(issuer: string, subject: string): string {
  return createHash("sha256").update(JSON.stringify([issuer, subject])).digest("hex");
}

export async function accountForIdentity(pool: pg.Pool, identity: VerifiedIdentity): Promise<{
  accountId: string; deleted: false; deletionEpoch: number;
} | null> {
  const digest = identityDigest(identity.issuer, identity.subject);
  return withTx(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`identity:${digest}`]);
    const deleted = await db.query("SELECT 1 FROM clerk_deleted_subjects WHERE identity_digest=$1", [digest]);
    if (deleted.rowCount) return null;
    const mapped = await db.query(`SELECT a.id,a.deleted_at,a.deletion_epoch FROM external_identities i
      JOIN accounts a ON a.id=i.account_id WHERE i.identity_digest=$1 FOR UPDATE OF a`, [digest]);
    const account = mapped.rows[0];
    if (account) return account.deleted_at ? null : { accountId: account.id, deleted: false, deletionEpoch: Number(account.deletion_epoch) };
    const accountId = crypto.randomUUID();
    await db.query("INSERT INTO accounts (id) VALUES ($1)", [accountId]);
    await db.query("INSERT INTO external_identities (identity_digest,account_id) VALUES ($1,$2)", [digest, accountId]);
    // Authentication is not a grant of paid allowance. Operator/customer funding remains explicit.
    await db.query("INSERT INTO allowance_accounts (account_id,limit_micro) VALUES ($1,0)", [accountId]);
    return { accountId, deleted: false, deletionEpoch: 0 };
  });
}

/**
 * Explicit authorized bounded new-member grant (F02 server path).
 *
 * Zero default is preserved: mapping never grants. This is the ONLY
 * production grant path for the new-member continuation: an authenticated
 * member claims a bounded amount against their own account.
 *
 * - Idempotent grant identity: entitlements.id = grantRequestId (uuid).
 *   Same id + same amount replays without double spend; same id + different
 *   amount is 409; same id + different account is 403 with no mutation.
 * - Aggregate cap: resulting limit_micro never exceeds 1_000_000 micro-units.
 * - Per-grant bound: 1..1_000_000 micro-units; zero/negative/unlimited denied.
 * - Account-switch safe: the grant row is bound to the requesting account.
 * - Guest payer untouched: only the member's own allowance_accounts row moves;
 *   guest sponsor ledgers/reservations are never written here.
 */
export const NEW_MEMBER_GRANT_PRODUCT_PREFIX = "new-member-continuation.v1";
export const NEW_MEMBER_GRANT_SOURCE = "explicit-member-grant.v1";
export const NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO = 1_000_000;

function grantFail(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { code, statusCode });
}

export async function grantNewMemberEntitlement(pool: pg.Pool, accountId: string,
  grantRequestId: string, amountMicro: number): Promise<{
  grantRequestId: string; accountId: string; amountMicro: number; limitMicro: number; reused: boolean;
}> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantRequestId))
    grantFail("invalid_input", 400);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 ||
      amountMicro > NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO) grantFail("invalid_input", 400);
  const product = `${NEW_MEMBER_GRANT_PRODUCT_PREFIX}:${amountMicro}`;
  return withTx(pool, async (db) => {
    const account = (await db.query<{ deletion_epoch: string }>(
      "SELECT deletion_epoch FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [accountId])).rows[0];
    if (!account) grantFail("authority_denied", 403);
    const existing = (await db.query<{ account_id: string; product: string }>(
      "SELECT account_id,product FROM entitlements WHERE id=$1", [grantRequestId])).rows[0];
    if (existing) {
      if (existing.account_id !== accountId) grantFail("authority_denied", 403);
      if (existing.product !== product) grantFail("idempotency_conflict", 409);
      const current = (await db.query<{ limit_micro: string }>(
        "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0];
      return { grantRequestId, accountId, amountMicro, limitMicro: Number(current?.limit_micro ?? 0), reused: true };
    }
    const allowance = (await db.query<{ limit_micro: string }>(
      "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1 FOR UPDATE", [accountId])).rows[0];
    if (!allowance) grantFail("authority_denied", 403);
    const nextLimit = Number(allowance.limit_micro) + amountMicro;
    if (!Number.isSafeInteger(nextLimit) || nextLimit > NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO)
      grantFail("permission_denied", 403);
    const inserted = await db.query(
      "INSERT INTO entitlements(id,account_id,product,source) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [grantRequestId, accountId, product, NEW_MEMBER_GRANT_SOURCE]);
    if ((inserted.rowCount ?? 0) === 0) {
      const raced = (await db.query<{ account_id: string; product: string }>(
        "SELECT account_id,product FROM entitlements WHERE id=$1", [grantRequestId])).rows[0];
      if (!raced || raced.account_id !== accountId) grantFail("authority_denied", 403);
      if (raced.product !== product) grantFail("idempotency_conflict", 409);
      const current = (await db.query<{ limit_micro: string }>(
        "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0];
      return { grantRequestId, accountId, amountMicro, limitMicro: Number(current?.limit_micro ?? 0), reused: true };
    }
    await db.query("UPDATE allowance_accounts SET limit_micro=limit_micro+$2 WHERE account_id=$1",
      [accountId, amountMicro]);
    const updated = (await db.query<{ limit_micro: string }>(
      "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0]!;
    return { grantRequestId, accountId, amountMicro, limitMicro: Number(updated.limit_micro), reused: false };
  });
}
