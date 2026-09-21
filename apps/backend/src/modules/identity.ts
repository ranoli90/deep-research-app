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
