import type { ResearchStrategy } from "../ports/research-strategy.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { CONSENT_POLICY_VERSION, DEFAULT_RUN_BUDGET_MICRO, type CreateRunRequest } from "@deep/contracts";
import { extractConstraints, inferOutputPreference } from "@deep/research-core";
import { withTx } from "../platform/db.js";
import { currentConsent } from "./access.js";
import { reserveAllowance } from "./billing.js";
import { admissionKeyHash } from "./admission-recovery.js";
import { emitEvent, findRunByIdempotency, getBrief, getRun, insertBrief, insertConversation, insertRun } from "./runs.js";

function reject(code: string): never { throw Object.assign(new Error(code), { code }); }

/** Account -> conversation -> run -> allowance is the admission lock order. No external I/O. */
export async function admitRun(pool: pg.Pool, accountId: string, key: string, input: CreateRunRequest, options: { strategy?: ResearchStrategy } = {}) {
  const digest = createHash("sha256").update(JSON.stringify({ ...input, attachmentIds: [...input.attachmentIds].sort() })).digest("hex");
  return withTx(pool, async (db) => {
    const account = await db.query("SELECT id, deleted_at FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
    if (!account.rows[0] || account.rows[0].deleted_at) reject("permission_denied");
    if ((await db.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1 AND key_hash=$2", [accountId,admissionKeyHash(key)])).rowCount)
      reject("idempotency_withdrawn");
    const consent = await currentConsent(db, accountId);
    if (!consent || consent.revoked || input.consentPolicyVersion !== CONSENT_POLICY_VERSION || (input.routeMode === "controlled-research" && consent.policyVersion !== CONSENT_POLICY_VERSION)) reject("consent_required");
    const existing = await findRunByIdempotency(db, accountId, key);
    if (existing) {
      if ((await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,existing.id])).rowCount) reject("permission_denied");
      const saved = await db.query("SELECT request_digest FROM runs WHERE id = $1", [existing.id]);
      if (saved.rows[0].request_digest !== digest) reject("idempotency_conflict");
      return { runId: existing.id, brief: await getBrief(db, existing.brief_id), reused: true };
    }
    for (const id of input.attachmentIds) {
      const attachment = await db.query("SELECT id FROM attachments WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL", [id, accountId]);
      if (!attachment.rows[0]) reject("permission_denied");
    }
    const parent = input.parentRunId ? await getRun(db, input.parentRunId) : null;
    if (input.parentRunId && (!parent || parent.account_id !== accountId)) reject("permission_denied");
    if (parent && (await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[accountId,parent.id])).rowCount) reject("permission_denied");
    if (parent && input.conversationId && parent.conversation_id !== input.conversationId) reject("permission_denied");
    const conversationId = input.conversationId ?? parent?.conversation_id ?? await insertConversation(db, accountId, input.question);
    const conversation = await db.query("SELECT id FROM conversations WHERE id = $1 AND account_id = $2 FOR UPDATE", [conversationId, accountId]);
    if (!conversation.rows[0]) reject("permission_denied");
    const revisions = await db.query<{ revision: number }>("SELECT COALESCE(MAX(revision), 0)::int AS revision FROM research_briefs WHERE conversation_id = $1", [conversationId]);
    const currentRevision = revisions.rows[0]!.revision;
    if (input.expectedBriefRevision !== undefined && input.expectedBriefRevision !== currentRevision) reject("stale_revision");
    const brief = {
      id: crypto.randomUUID(), conversationId, originalQuestion: input.question, language: "en",
      attachmentIds: input.attachmentIds, sourceRestrictions: [], nonGoals: [], constraints: extractConstraints(input.question),
      assumptions: [], budgetPolicyId: "default", consentPolicyVersion: CONSENT_POLICY_VERSION, revision: currentRevision + 1,
      outputPreferences: input.outputPreferences ?? inferOutputPreference(input.question),
    };
    await insertBrief(db, brief, accountId);
    const runId = crypto.randomUUID();
    await insertRun(db, { id: runId, accountId, conversationId, briefId: brief.id, parentRunId: input.parentRunId,
      routeMode: input.routeMode, briefRevision: brief.revision, consentEpoch: consent.epoch, idempotencyKey: key,
      budgetMicro: DEFAULT_RUN_BUDGET_MICRO, researchStrategy: options.strategy });
    await db.query("UPDATE runs SET request_digest = $2 WHERE id = $1", [runId, digest]);
    await reserveAllowance(db, accountId, runId, DEFAULT_RUN_BUDGET_MICRO);
    await emitEvent(db, { runId, accountId, type: "accepted", phase: "preparing",
      summary: "Research accepted. Closing the app will not stop the server job." });
    return { runId, brief, reused: false };
  });
}
