import type { CanonicalReport, RevisionBasis } from "@deep/contracts";
import { canPublish, checkReportCitations, type StoredClaim, type StoredPassage } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";
import { getRun, markTerminal } from "./runs.js";
import { settleRun } from "./billing.js";

export async function publishReport(
  db: Queryable,
  args: {
    report: CanonicalReport;
    accountId: string;
    loaded: RevisionBasis;
    claims: StoredClaim[];
    passages: StoredPassage[];
    deleted: boolean;
  },
): Promise<{ accepted: boolean; reason: string; reportId?: string }> {
  const run = await getRun(db, args.report.runId);
  if (!run) return { accepted: false, reason: "missing_run" };
  const current: RevisionBasis = {
    briefRevision: run.brief_revision,
    evidenceRevision: run.evidence_revision,
    consentEpoch: run.consent_epoch,
    cancellationEpoch: run.cancellation_epoch,
    workerLeaseFence: run.worker_lease_fence,
  };
  const problems = checkReportCitations(args.report.blocks, args.claims, args.passages);
  const reason = canPublish({
    loaded: args.loaded,
    current,
    deleted: args.deleted,
    unknownCitationIds: problems.unknownIds,
    unsupportedCitationCount: problems.unsupported.length,
  });
  await db.query(
    `INSERT INTO publication_attempts (run_id, fence, accepted, reason) VALUES ($1,$2,$3,$4)`,
    [args.report.runId, JSON.stringify({ loaded: args.loaded, current }), reason === "ok", reason],
  );
  if (reason !== "ok") return { accepted: false, reason };
  if (run.lifecycle === "terminal" && run.terminal_outcome && run.terminal_outcome !== "cancelled") {
    return { accepted: false, reason: "already_published" };
  }
  const reportId = args.report.reportId;
  const nextEpoch = run.completion_epoch + 1;
  await db.query(
    `INSERT INTO reports (id, run_id, account_id, version, outcome, basis, blocks, claim_ids, limitations, source_access_summary, change_summary, route_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      reportId,
      args.report.runId,
      args.accountId,
      args.report.version,
      args.report.outcome,
      JSON.stringify(args.report.basis),
      JSON.stringify(args.report.blocks),
      args.report.claimIds,
      JSON.stringify(args.report.limitations),
      JSON.stringify(args.report.sourceAccessSummary),
      args.report.changeSummary ? JSON.stringify(args.report.changeSummary) : null,
      args.report.routeMode,
    ],
  );
  await db.query(`UPDATE runs SET completion_epoch = $2 WHERE id = $1`, [args.report.runId, nextEpoch]);
  await db.query(
    `INSERT INTO completion_outbox (run_id, completion_epoch, account_id, state)
     VALUES ($1,$2,$3,'recorded')
     ON CONFLICT (run_id, completion_epoch) DO NOTHING`,
    [args.report.runId, nextEpoch, args.accountId],
  );
  await recordFanout(db, {
    runId: args.report.runId,
    completionEpoch: nextEpoch,
    bindingEpoch: 1,
    deviceId: "unbound",
  });
  await markTerminal(db, args.report.runId, args.report.outcome);
  await settleRun(db, args.accountId, args.report.runId, run.spent_micro);
  return { accepted: true, reason: "ok", reportId };
}

export async function getReportForAccount(db: Queryable, reportId: string, accountId: string) {
  const res = await db.query(`SELECT * FROM reports WHERE id = $1 AND account_id = $2`, [reportId, accountId]);
  return res.rows[0] ?? null;
}

export async function getLatestReportForRun(db: Queryable, runId: string, accountId: string) {
  const res = await db.query(
    `SELECT * FROM reports WHERE run_id = $1 AND account_id = $2 ORDER BY version DESC LIMIT 1`,
    [runId, accountId],
  );
  return res.rows[0] ?? null;
}

export function completionDispatchPayload(runId: string, completionEpoch: number): Record<string, unknown> {
  return {
    runId,
    completionEpoch,
    title: "Research ready",
    body: "Open the app to view your report.",
  };
}

export async function recordFanout(
  db: Queryable,
  args: { runId: string; completionEpoch: number; bindingEpoch: number; deviceId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO notification_fanout (run_id, completion_epoch, binding_epoch, device_id, state, payload)
     VALUES ($1,$2,$3,$4,'recorded',$5)
     ON CONFLICT (run_id, completion_epoch, binding_epoch, device_id) DO NOTHING`,
    [
      args.runId,
      args.completionEpoch,
      args.bindingEpoch,
      args.deviceId,
      JSON.stringify(completionDispatchPayload(args.runId, args.completionEpoch)),
    ],
  );
}

export function fanoutAllowed(currentBindingEpoch: number, rowBindingEpoch: number): boolean {
  return currentBindingEpoch === rowBindingEpoch;
}

export async function insertChallenge(
  db: Queryable,
  args: { accountId: string; reportId: string; claimId?: string; category: string; note?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO challenges (id, account_id, report_id, claim_id, category, note) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, args.accountId, args.reportId, args.claimId ?? null, args.category, args.note ?? null],
  );
  return id;
}
