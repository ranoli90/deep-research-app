import type { Lifecycle, Phase, ResearchBrief, TerminalOutcome } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";

export type RunRow = {
  id: string;
  account_id: string;
  conversation_id: string;
  brief_id: string;
  parent_run_id: string | null;
  route_mode: string;
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

export async function getBrief(db: Queryable, briefId: string): Promise<ResearchBrief> {
  const res = await db.query<{ payload: ResearchBrief }>(`SELECT payload FROM research_briefs WHERE id = $1`, [briefId]);
  if (!res.rows[0]) throw new Error("brief missing");
  return res.rows[0].payload;
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
    briefRevision: number;
    consentEpoch: number;
    idempotencyKey: string;
    budgetMicro: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO runs (
      id, account_id, conversation_id, brief_id, parent_run_id, route_mode, lifecycle, phase,
      brief_revision, consent_epoch, idempotency_key, budget_micro
    ) VALUES ($1,$2,$3,$4,$5,$6,'queued','preparing',$7,$8,$9,$10)`,
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
    ],
  );
}

export async function emitEvent(
  db: Queryable,
  args: { runId: string; accountId: string; type: string; summary: string; phase: Phase; payload?: unknown },
): Promise<void> {
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
  const run = await getRun(db, runId);
  if (!run || run.lifecycle === "terminal") return null;
  const existing = await db.query<{ fence: string; owner: string; expires_at: Date }>(
    `SELECT fence, owner, expires_at FROM run_leases WHERE run_id = $1`,
    [runId],
  );
  const held = existing.rows[0];
  if (held && new Date(held.expires_at).getTime() > Date.now() && held.owner !== owner) {
    return null;
  }
  if (held && new Date(held.expires_at).getTime() > Date.now() && held.owner === owner) {
    await db.query(
      `UPDATE run_leases SET expires_at = now() + ($2 || ' milliseconds')::interval WHERE run_id = $1`,
      [runId, String(leaseMs)],
    );
    return Number(held.fence);
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
     VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)
     ON CONFLICT (run_id) DO UPDATE SET fence = EXCLUDED.fence, owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at`,
    [runId, fence, owner, String(leaseMs)],
  );
  return fence;
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
