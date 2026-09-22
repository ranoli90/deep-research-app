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
 * Server-owned bounded new-member trial (F02 server path).
 *
 * Zero default is preserved: mapping never grants. This is the ONLY
 * production grant path for the new-member continuation. The SERVER selects the
 * policy, credited amount, eligibility, once-only business identity, expiry and
 * funded sponsor exposure; the caller-supplied `amountMicro` is only an
 * idempotency request fingerprint and never determines credit.
 *
 * - Idempotent grant identity: entitlements.id = grantRequestId (uuid).
 *   Same id + same request fingerprint replays without double spend; same id +
 *   different request fingerprint is 409; same id + a different owner is 403
 *   with no mutation. An entitlement recorded under an unknown source/product
 *   is an unknown receipt: held (409), never re-credited.
 * - Once-only business entitlement: at most one trial per account regardless of
 *   how many distinct grantRequestId values the caller supplies, independent of
 *   the client-supplied amount. Enforced under the account lock.
 * - First-claim eligibility: a genuinely new, unfunded member (zero limit,
 *   settled and reserved). Prior paid allowance is never converted into a trial.
 * - Policy gate: the server policy row must be enabled, not killed and unexpired;
 *   the credited amount comes from that row, never the request.
 * - Global subsidy reservation: the shared trial ledger reserves the policy
 *   amount before credit and refuses when the approved exposure cap is reached.
 * - Account-switch safe: the grant row is bound to the requesting account.
 * - Guest payer untouched: only the member's own allowance_accounts row and the
 *   separate new_member_trial_ledgers row move; guest sponsor ledgers and
 *   reservations are never written here.
 */
export const NEW_MEMBER_GRANT_PRODUCT_PREFIX = "new-member-continuation.v1";
export const NEW_MEMBER_GRANT_SOURCE = "new-member-trial.v1";
export const NEW_MEMBER_GRANT_POLICY_ID = "norrow-new-member-trial.v1";
export const NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO = 1_000_000;

export type NewMemberGrantPolicy = {
  id: string;
  enabled: boolean;
  killed: boolean;
  expiresAt: Date;
  amountMicro: number;
  exposureCapMicro: number;
};

/** Pure server-policy gate: a grant is open only when enabled, unkilled, unexpired and bounded. */
export function newMemberGrantPolicyOpen(policy: NewMemberGrantPolicy, now: Date = new Date()): boolean {
  return policy.enabled && !policy.killed && policy.expiresAt.getTime() > now.getTime() &&
    Number.isSafeInteger(policy.amountMicro) && policy.amountMicro > 0 &&
    Number.isSafeInteger(policy.exposureCapMicro) && policy.exposureCapMicro >= 0;
}

function grantFail(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { code, statusCode });
}

type GrantOutcome = {
  grantRequestId: string; accountId: string; amountMicro: number; limitMicro: number; reused: boolean;
};

export async function grantNewMemberEntitlement(pool: pg.Pool, accountId: string,
  grantRequestId: string, amountMicro: number): Promise<GrantOutcome> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantRequestId))
    grantFail("invalid_input", 400);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 ||
      amountMicro > NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO) grantFail("invalid_input", 400);
  const requestProduct = `${NEW_MEMBER_GRANT_PRODUCT_PREFIX}:${amountMicro}`;
  return withTx(pool, async (db) => {
    const account = (await db.query<{ deletion_epoch: string }>(
      "SELECT deletion_epoch FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [accountId])).rows[0];
    if (!account) grantFail("authority_denied", 403);

    // The mobile business identity is the claimed continuation request id. When the
    // grant identity names a real claim, it must belong to the requesting member.
    const claim = (await db.query<{ member_account_id: string }>(
      "SELECT member_account_id FROM guest_claim_requests WHERE request_id=$1", [grantRequestId])).rows[0];
    if (claim && claim.member_account_id !== accountId) grantFail("authority_denied", 403);

    const existing = (await db.query<{ account_id: string; product: string; source: string; amount_micro: string | null }>(
      "SELECT account_id,product,source,amount_micro FROM entitlements WHERE id=$1", [grantRequestId])).rows[0];
    if (existing) {
      if (existing.account_id !== accountId) grantFail("authority_denied", 403);
      // Unknown receipt: the identity exists but not under this trial's recorded terms.
      if (existing.source !== NEW_MEMBER_GRANT_SOURCE || existing.product !== requestProduct)
        grantFail("idempotency_conflict", 409);
      const current = (await db.query<{ limit_micro: string }>(
        "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0];
      return { grantRequestId, accountId,
        amountMicro: existing.amount_micro === null ? 0 : Number(existing.amount_micro),
        limitMicro: Number(current?.limit_micro ?? 0), reused: true };
    }

    const policyRow = (await db.query<{ id: string; enabled: boolean; killed: boolean; expires_at: Date;
      amount_micro: string; exposure_cap_micro: string }>(
      `SELECT id,enabled,killed,expires_at,amount_micro,exposure_cap_micro
       FROM new_member_trial_policies WHERE id=$1 FOR UPDATE`, [NEW_MEMBER_GRANT_POLICY_ID])).rows[0];
    const policy: NewMemberGrantPolicy | null = policyRow ? {
      id: policyRow.id, enabled: policyRow.enabled, killed: policyRow.killed,
      expiresAt: policyRow.expires_at, amountMicro: Number(policyRow.amount_micro),
      exposureCapMicro: Number(policyRow.exposure_cap_micro),
    } : null;
    if (!policy || !newMemberGrantPolicyOpen(policy)) grantFail("permission_denied", 403);

    const allowance = (await db.query<{ limit_micro: string; settled_micro: string; reserved_micro: string }>(
      "SELECT limit_micro,settled_micro,reserved_micro FROM allowance_accounts WHERE account_id=$1 FOR UPDATE",
      [accountId])).rows[0];
    if (!allowance) grantFail("authority_denied", 403);
    // First-claim eligibility: an unfunded new member. Any prior paid/settled/reserved
    // allowance (or a prior trial) is not a first claim and never earns another trial.
    if (Number(allowance.limit_micro) !== 0 || Number(allowance.settled_micro) !== 0 ||
        Number(allowance.reserved_micro) !== 0) grantFail("permission_denied", 403);
    if ((await db.query(
      "SELECT 1 FROM entitlements WHERE account_id=$1 AND source=$2 LIMIT 1",
      [accountId, NEW_MEMBER_GRANT_SOURCE])).rowCount) grantFail("permission_denied", 403);

    const credited = policy.amountMicro;
    const nextLimit = Number(allowance.limit_micro) + credited;
    if (!Number.isSafeInteger(nextLimit) || nextLimit > NEW_MEMBER_GRANT_AGGREGATE_CAP_MICRO)
      grantFail("permission_denied", 403);

    const ledger = (await db.query<{ settled_micro: string; reserved_micro: string; held_micro: string }>(
      "SELECT settled_micro,reserved_micro,held_micro FROM new_member_trial_ledgers WHERE policy_id=$1 FOR UPDATE",
      [NEW_MEMBER_GRANT_POLICY_ID])).rows[0];
    if (!ledger) grantFail("permission_denied", 403);
    const committed = Number(ledger.settled_micro) + Number(ledger.reserved_micro) + Number(ledger.held_micro);
    if (!Number.isSafeInteger(committed) || committed + credited > policy.exposureCapMicro)
      grantFail("allowance_exhausted", 402);
    await db.query("UPDATE new_member_trial_ledgers SET reserved_micro=reserved_micro+$2,updated_at=now() WHERE policy_id=$1",
      [NEW_MEMBER_GRANT_POLICY_ID, credited]);

    const inserted = await db.query(
      `INSERT INTO entitlements(id,account_id,product,source,amount_micro) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [grantRequestId, accountId, requestProduct, NEW_MEMBER_GRANT_SOURCE, credited]);
    if ((inserted.rowCount ?? 0) === 0) {
      // A concurrent writer owns this identity (or this account's once-only slot):
      // re-read and resolve exactly like the replay path; the transaction rolls the
      // ledger reservation back on any denial.
      const raced = (await db.query<{ account_id: string; product: string; source: string; amount_micro: string | null }>(
        "SELECT account_id,product,source,amount_micro FROM entitlements WHERE id=$1", [grantRequestId])).rows[0];
      if (!raced) grantFail("permission_denied", 403);
      if (raced.account_id !== accountId) grantFail("authority_denied", 403);
      if (raced.source !== NEW_MEMBER_GRANT_SOURCE || raced.product !== requestProduct)
        grantFail("idempotency_conflict", 409);
      const current = (await db.query<{ limit_micro: string }>(
        "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0];
      return { grantRequestId, accountId,
        amountMicro: raced.amount_micro === null ? 0 : Number(raced.amount_micro),
        limitMicro: Number(current?.limit_micro ?? 0), reused: true };
    }
    await db.query("UPDATE allowance_accounts SET limit_micro=limit_micro+$2 WHERE account_id=$1",
      [accountId, credited]);
    const updated = (await db.query<{ limit_micro: string }>(
      "SELECT limit_micro FROM allowance_accounts WHERE account_id=$1", [accountId])).rows[0]!;
    return { grantRequestId, accountId, amountMicro: credited, limitMicro: Number(updated.limit_micro), reused: false };
  });
}
