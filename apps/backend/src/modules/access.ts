import { createHash, randomBytes } from "node:crypto";
import { CONSENT_POLICY_VERSION, PROCESSOR_DISCLOSURE } from "@deep/contracts";
import { withTx, type Queryable } from "../platform/db.js";
import pg from "pg";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDevSession(db: Queryable, email?: string): Promise<{ accountId: string; token: string }> {
  const accountId = crypto.randomUUID();
  const token = `dev_${randomBytes(24).toString("hex")}`;
  await db.query(`INSERT INTO accounts (id, email) VALUES ($1, $2)`, [accountId, email ?? `dev-${accountId.slice(0, 8)}@localhost`]);
  await db.query(
    `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
    [accountId, hashToken(token)],
  );
  await db.query(
    `INSERT INTO allowance_accounts (account_id, limit_micro) VALUES ($1, $2)`,
    [accountId, 10_000_000],
  );
  return { accountId, token };
}

export async function accountFromBearer(db: Queryable, header: string | undefined): Promise<{
  accountId: string;
  deleted: boolean;
  deletionEpoch: number;
} | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const row = await db.query<{ account_id: string; deleted_at: Date | null; deletion_epoch: string }>(
    `SELECT a.id AS account_id, a.deleted_at, a.deletion_epoch
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const r = row.rows[0];
  if (!r) return null;
  return { accountId: r.account_id, deleted: Boolean(r.deleted_at), deletionEpoch: Number(r.deletion_epoch) };
}

export async function currentConsent(db: Queryable, accountId: string): Promise<{ epoch: number; revoked: boolean; policyVersion: string } | null> {
  const res = await db.query<{ consent_epoch: string; revoked_at: Date | null; policy_version: string }>(
    `SELECT consent_epoch, revoked_at, policy_version FROM consent_records
     WHERE account_id = $1 ORDER BY consent_epoch DESC LIMIT 1`,
    [accountId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return { epoch: Number(r.consent_epoch), revoked: Boolean(r.revoked_at), policyVersion: r.policy_version };
}

export async function grantConsent(db: Queryable, accountId: string): Promise<{ epoch: number; processors: string[] }> {
  if (db instanceof pg.Pool) return withTx(db, (client) => grantConsent(client, accountId));
  const account = await db.query("SELECT id FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [accountId]);
  if (!account.rows[0]) throw new Error("account unavailable");
  const prev = await currentConsent(db, accountId);
  const epoch = (prev?.epoch ?? 0) + 1;
  await db.query(
    `INSERT INTO consent_records (account_id, policy_version, processors, consent_epoch)
     VALUES ($1, $2, $3, $4)`,
    [accountId, CONSENT_POLICY_VERSION, JSON.stringify(PROCESSOR_DISCLOSURE), epoch],
  );
  return { epoch, processors: [...PROCESSOR_DISCLOSURE] };
}

export async function revokeConsent(db: Queryable, accountId: string): Promise<number> {
  if (db instanceof pg.Pool) return withTx(db, (client) => revokeConsent(client, accountId));
  await db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
  const prev = await currentConsent(db, accountId);
  const epoch = (prev?.epoch ?? 0) + 1;
  await db.query(
    `INSERT INTO consent_records (account_id, policy_version, processors, consent_epoch, revoked_at)
     VALUES ($1, $2, $3, $4, now())`,
    [accountId, CONSENT_POLICY_VERSION, JSON.stringify(PROCESSOR_DISCLOSURE), epoch],
  );
  // In-flight workers loaded the previous epoch; bump the run fence so late publication is consent_revoked.
  await db.query(
    `UPDATE runs SET consent_epoch = $2, updated_at = now()
     WHERE account_id = $1 AND lifecycle <> 'terminal'`,
    [accountId, epoch],
  );
  return epoch;
}

export async function consentAllowsProcessing(db: Queryable, accountId: string): Promise<boolean> {
  const c = await currentConsent(db, accountId);
  return Boolean(c && !c.revoked);
}

export async function deleteAccount(db: Queryable, accountId: string): Promise<void> {
  await db.query(`UPDATE accounts SET deleted_at = now(), deletion_epoch = deletion_epoch + 1 WHERE id = $1`, [accountId]);
  await db.query(`DELETE FROM extraction_receipts WHERE account_id = $1`, [accountId]);
  await db.query(`DELETE FROM evidence_artifacts WHERE account_id = $1`, [accountId]);
  await db.query(
    `UPDATE runs SET lifecycle = 'cancelling', cancellation_epoch = cancellation_epoch + 1, updated_at = now()
     WHERE account_id = $1 AND lifecycle <> 'terminal'`,
    [accountId],
  );
  await db.query(
    `UPDATE passages SET exact_text = '[deleted]' WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `UPDATE reports SET
       blocks = '[]'::jsonb,
       redacted_at = now(),
       limitations = limitations || '["private content deleted"]'::jsonb
     WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `UPDATE attachments SET deleted_at = now(), extracted_text = NULL, processing_state = 'deleted' WHERE account_id = $1`,
    [accountId],
  );
  await db.query(
    `INSERT INTO tombstones (account_id, object_kind, object_id, reason)
     SELECT $1, 'account', $1, 'account_deletion'`,
    [accountId],
  );
  await db.query(`DELETE FROM sessions WHERE account_id = $1`, [accountId]);
}
