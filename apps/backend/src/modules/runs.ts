import {strictPolicyForNewAdmission,modelPolicy,type ModelPolicyId} from "../ports/model-policy.js";
import { researchStrategy, type ResearchStrategy } from "../ports/research-strategy.js";
import type { Lifecycle, Phase, ResearchBrief, TerminalOutcome } from "@deep/contracts";
import { ResearchBriefSchema } from "@deep/contracts";
import { withTx, type Queryable } from "../platform/db.js";
import pg from "pg";
import { lockActiveAccount } from "./access.js";

export type RunRow = {
  id: string;
  account_id: string;
  conversation_id: string;
  brief_id: string;
  parent_run_id: string | null;
  route_mode: string;
  research_strategy: ResearchStrategy;
  model_policy_id: string;
  lifecycle: Lifecycle;
  phase: Phase;
  terminal_outcome: TerminalOutcome | null;
  brief_revision: number;
  evidence_revision: number;
  consent_epoch: number;
  cancellation_epoch: number;
  worker_lease_fence: number;
  completion_epoch: number;
  idempotency_key: string | null;
  budget_micro: number;
  spent_micro: number;
};

function mapRun(r: Record<string, unknown>): RunRow {
  return {
    id: String(r.id),
    account_id: String(r.account_id),
    conversation_id: String(r.conversation_id),
    brief_id: String(r.brief_id),
    parent_run_id: r.parent_run_id ? String(r.parent_run_id) : null,
    route_mode: String(r.route_mode),
    research_strategy: researchStrategy(r.research_strategy),
    model_policy_id: String(r.model_policy_id),
    lifecycle: r.lifecycle as Lifecycle,
    phase: r.phase as Phase,
    terminal_outcome: (r.terminal_outcome as TerminalOutcome) ?? null,
    brief_revision: Number(r.brief_revision),
    evidence_revision: Number(r.evidence_revision),
    consent_epoch: Number(r.consent_epoch),
    cancellation_epoch: Number(r.cancellation_epoch),
    worker_lease_fence: Number(r.worker_lease_fence),
    completion_epoch: Number(r.completion_epoch),
    idempotency_key: r.idempotency_key ? String(r.idempotency_key) : null,
    budget_micro: Number(r.budget_micro),
    spent_micro: Number(r.spent_micro),
  };
}

export async function findRunByIdempotency(db: Queryable, accountId: string, key: string): Promise<RunRow | null> {
  const res = await db.query(`SELECT * FROM runs WHERE account_id = $1 AND idempotency_key = $2`, [accountId, key]);
  return res.rows[0] ? mapRun(res.rows[0] as Record<string, unknown>) : null;
}

export async function getRun(
  db: Queryable,
  runId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<RunRow | null> {
  const res = await db.query(
    opts.forUpdate ? `SELECT * FROM runs WHERE id = $1 FOR UPDATE` : `SELECT * FROM runs WHERE id = $1`,
    [runId],
  );
  return res.rows[0] ? mapRun(res.rows[0] as Record<string, unknown>) : null;
}

export async function insertConversation(db: Queryable, accountId: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(`INSERT INTO conversations (id, account_id, title) VALUES ($1,$2,$3)`, [id, accountId, title.slice(0, 120)]);
  return id;
}

export async function insertBrief(db: Queryable, brief: ResearchBrief, accountId: string): Promise<void> {
  await db.query(
    `INSERT INTO research_briefs (id, conversation_id, account_id, original_question, payload, revision)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [brief.id, brief.conversationId, accountId, brief.originalQuestion, JSON.stringify(brief), brief.revision],
  );
}

/** New brief identity for semantic change. Never mutates a prior brief row or originalQuestion. */
export async function commitBriefRevision(
  db: Queryable,
  args: {
    accountId: string;
    runId: string;
    expectedRevision: number;
    originalQuestion: string;
    next: Omit<ResearchBrief, "id" | "revision"> & { id?: string; revision?: number };
  },
): Promise<{ brief: ResearchBrief; briefRevision: number }> {
  const run = await getRun(db, args.runId, { forUpdate: true });
  if (!run || run.account_id !== args.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
  if (run.brief_revision !== args.expectedRevision) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
  const current = await getBrief(db, run.brief_id);
  if (current.originalQuestion !== args.originalQuestion) throw Object.assign(new Error("original_question_mismatch"), { statusCode: 409 });
  const revision = Number((await db.query(
    "SELECT COALESCE(MAX(revision),0)::integer+1 AS revision FROM research_briefs WHERE conversation_id=$1",
    [run.conversation_id],
  )).rows[0]?.revision ?? current.revision + 1);
  const brief = ResearchBriefSchema.parse({
    ...current,
    ...args.next,
    id: crypto.randomUUID(),
    conversationId: current.conversationId,
    originalQuestion: args.originalQuestion,
    revision,
  });
  await insertBrief(db, brief, args.accountId);
  await db.query(
    `UPDATE runs SET brief_id=$2, brief_revision=$3, updated_at=now() WHERE id=$1 AND account_id=$4 AND brief_revision=$5`,
    [args.runId, brief.id, revision, args.accountId, args.expectedRevision],
  );
  return { brief, briefRevision: revision };
}

export async function getBrief(db: Queryable, briefId: string): Promise<ResearchBrief> {
  const res = await db.query<{ original_question: string; payload: ResearchBrief }>(
    `SELECT original_question, payload FROM research_briefs WHERE id = $1`,
    [briefId],
  );
  if (!res.rows[0]) throw new Error("brief missing");
  const payload = res.rows[0].payload;
  const column = res.rows[0].original_question;
  if (typeof payload?.originalQuestion === "string" && payload.originalQuestion !== column) {
    throw new Error("original_question_mismatch");
  }
  return payload;
}

export async function insertRun(
  db: Queryable,
  row: {
    id: string;
    accountId: string;
    conversationId: string;
    briefId: string;
    parentRunId?: string;
    routeMode: string;
    researchStrategy?: ResearchStrategy;
    modelPolicyId?: ModelPolicyId;
    briefRevision: number;
    consentEpoch: number;
    idempotencyKey: string;
    budgetMicro: number;
  },
): Promise<void> {
  if (db instanceof pg.Pool) return withTx(db, (client) => insertRun(client, row));
  const parent = row.parentRunId ? await getRun(db, row.parentRunId) : null;
  if (row.parentRunId && (!parent || parent.account_id !== row.accountId)) throw new Error("permission_denied");
  if (parent && (await db.query("SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion'",[row.accountId,parent.id])).rowCount) throw Object.assign(new Error("source_deleted"),{code:"permission_denied",statusCode:409});
  const strategy = parent?.research_strategy ?? researchStrategy(row.researchStrategy);
  const policy = modelPolicy(parent ? strictPolicyForNewAdmission(parent.model_policy_id) : row.modelPolicyId);
  await db.query(
    `INSERT INTO runs (
      id, account_id, conversation_id, brief_id, parent_run_id, route_mode, lifecycle, phase,
      brief_revision, consent_epoch, idempotency_key, budget_micro, research_strategy, model_policy_id
    ) VALUES ($1,$2,$3,$4,$5,$6,'queued','preparing',$7,$8,$9,$10,$11,$12)`,
    [
      row.id,
      row.accountId,
      row.conversationId,
      row.briefId,
      row.parentRunId ?? null,
      row.routeMode,
      row.briefRevision,
      row.consentEpoch,
      row.idempotencyKey,
      row.budgetMicro,
      strategy,
      policy.id,
    ],
  );
  await db.query(`INSERT INTO run_dispatch_outbox (run_id) VALUES ($1) ON CONFLICT DO NOTHING`, [row.id]);
}

export async function emitEvent(
  db: Queryable,
  args: { runId: string; accountId: string; type: string; summary: string; phase: Phase; payload?: unknown },
): Promise<void> {
  if (db instanceof pg.Pool) return withTx(db, (client) => emitEvent(client, args));
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [args.runId]);
  await db.query(
    `INSERT INTO run_events (run_id, account_id, sequence, type, public_summary, phase, payload)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(sequence) FROM run_events WHERE run_id = $1), 0) + 1,
       $3, $4, $5, $6
     )`,
    [args.runId, args.accountId, args.type, args.summary, args.phase, JSON.stringify(args.payload ?? {})],
  );
}

export async function listEvents(db: Queryable, runId: string, after = 0): Promise<
  { id: string; sequence: number; type: string; public_summary: string; phase: string; created_at: Date; payload: unknown }[]
> {
  const res = await db.query(
    `SELECT id, sequence, type, public_summary, phase, created_at, payload
     FROM run_events WHERE run_id = $1 AND sequence > $2 ORDER BY sequence ASC`,
    [runId, after],
  );
  return res.rows as never;
}

export async function claimLease(db: Queryable, runId: string, owner: string, leaseMs: number): Promise<number | null> {
  if (db instanceof pg.Pool) return withTx(db, (client) => claimLease(client, runId, owner, leaseMs));
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error("invalid lease duration");
  const run = await getRun(db, runId, { forUpdate: true });
  if (!run || run.lifecycle === "terminal") return null;
  const existing = await db.query<{ fence: string; owner: string; active: boolean }>(
    `SELECT fence, owner, expires_at > clock_timestamp() AS active FROM run_leases WHERE run_id = $1 FOR UPDATE`,
    [runId],
  );
  const held = existing.rows[0];
  if (held?.active) {
    return null;
  }
  const fence = run.worker_lease_fence + 1;
  await db.query(
    `UPDATE runs
     SET worker_lease_fence = $2,
         lifecycle = CASE WHEN lifecycle IN ('terminal', 'cancelling') THEN lifecycle ELSE 'running' END,
         updated_at = now()
     WHERE id = $1`,
    [runId, fence],
  );
  await db.query(
    `INSERT INTO run_leases (run_id, fence, owner, expires_at)
     VALUES ($1,$2,$3, clock_timestamp() + ($4 || ' milliseconds')::interval)
     ON CONFLICT (run_id) DO UPDATE SET fence = EXCLUDED.fence, owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at`,
    [runId, fence, owner, String(leaseMs)],
  );
  return fence;
}

export async function renewLease(db: Queryable, runId: string, owner: string, fence: number, leaseMs: number): Promise<boolean> {
  if (db instanceof pg.Pool) return withTx(db, (client) => renewLease(client, runId, owner, fence, leaseMs));
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error("invalid lease duration");
  // Acquire both rows before checking wall-clock expiry. A single UPDATE can
  // evaluate its predicate before blocking on another transaction's row lock.
  await getRun(db, runId, { forUpdate: true });
  await db.query("SELECT run_id FROM run_leases WHERE run_id = $1 FOR UPDATE", [runId]);
  const result = await db.query(`UPDATE run_leases l SET expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
    FROM runs r WHERE l.run_id = $1 AND r.id = l.run_id AND l.owner = $2 AND l.fence = $3
      AND r.worker_lease_fence = $3 AND r.lifecycle <> 'terminal' AND l.expires_at > clock_timestamp()`,
    [runId, owner, fence, leaseMs]);
  return result.rowCount === 1;
}

export async function checkpoint(db: Queryable, runId: string, evidenceRevision: number, phase: Phase, payload: unknown): Promise<void> {
  await db.query(
    `INSERT INTO checkpoints (run_id, evidence_revision, phase, payload) VALUES ($1,$2,$3,$4)`,
    [runId, evidenceRevision, phase, JSON.stringify(payload)],
  );
}

export async function bumpEvidence(db: Queryable, runId: string): Promise<number> {
  const res = await db.query<{ evidence_revision: number }>(
    `UPDATE runs SET evidence_revision = evidence_revision + 1, updated_at = now() WHERE id = $1 RETURNING evidence_revision`,
    [runId],
  );
  return Number(res.rows[0]?.evidence_revision ?? 0);
}

export async function addSpent(db: Queryable, runId: string, micro: number): Promise<void> {
  await db.query(`UPDATE runs SET spent_micro = spent_micro + $2, updated_at = now() WHERE id = $1`, [runId, micro]);
}

export async function setPhase(db: Queryable, runId: string, phase: Phase): Promise<void> {
  await db.query(`UPDATE runs SET phase = $2, updated_at = now() WHERE id = $1`, [runId, phase]);
}

/** Ownership, cancellation and its event share deletion's account/run lock order. */
export async function cancelOwnedRun(pool: pg.Pool, accountId: string, runId: string): Promise<RunRow | null> {
  return withTx(pool, async (db) => {
    await lockActiveAccount(db, accountId);
    const run = await getRun(db, runId, { forUpdate: true });
    if (!run || run.account_id !== accountId) return null;
    const updated = await cancelRun(db, runId);
    if (!updated) throw new Error("cancellation_run_disappeared");
    await emitEvent(db, {
      runId, accountId, type: "cancel_requested", phase: updated.phase,
      summary: "Stopping new work. An already-issued provider call may still finish accounting.",
    });
    return updated;
  });
}

export async function cancelRun(db: Queryable, runId: string): Promise<RunRow | null> {
  const res = await db.query(
    `UPDATE runs
     SET cancellation_epoch = cancellation_epoch + 1,
         lifecycle = CASE WHEN lifecycle = 'terminal' THEN lifecycle ELSE 'cancelling' END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [runId],
  );
  return res.rows[0] ? mapRun(res.rows[0] as Record<string, unknown>) : null;
}

export async function markTerminal(
  db: Queryable,
  runId: string,
  outcome: TerminalOutcome,
): Promise<void> {
  await db.query(
    `UPDATE runs SET lifecycle = 'terminal', terminal_outcome = $2, updated_at = now() WHERE id = $1`,
    [runId, outcome],
  );
}

export async function listLibrary(db: Queryable, accountId: string): Promise<
  { id: string; title: string; status: string; created_at: Date; report_id: string | null }[]
> {
  const res = await db.query(
    `SELECT r.id, COALESCE(c.title, 'Untitled') AS title,
            COALESCE(r.terminal_outcome, r.lifecycle) AS status, r.created_at,
            (SELECT rp.id FROM reports rp WHERE rp.run_id = r.id AND rp.account_id = r.account_id AND rp.redacted_at IS NULL
             ORDER BY rp.version DESC LIMIT 1) AS report_id
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE r.account_id = $1
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [accountId],
  );
  return res.rows as never;
}
