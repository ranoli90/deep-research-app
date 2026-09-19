import { calculationPublicationClaims } from "./calculation-publication.js";
import { deriveReportChanges } from "./report-changes.js";
import type { CanonicalReport, ReportBlock, RevisionBasis } from "@deep/contracts";
import { canPublish, citationValidationFails, LATER_EVIDENCE_LIMITATION, validateMaterialCitations, type StoredClaim, type StoredPassage } from "@deep/research-core";
import { withTx, type Queryable } from "../platform/db.js";
import pg from "pg";
import { currentConsent, lockActiveAccount } from "./access.js";
import { getBrief, getRun, markTerminal } from "./runs.js";
import { settleRun } from "./billing.js";
import { reportCompletionCovered } from "./publication-coverage.js";
import { scopedPublicationClaims } from "./scoped-publication.js";
import { persistCheckedClaims } from "./claim-support.js";
import { loadEvidence } from "./evidence.js";

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
  if (db instanceof pg.Pool) return withTx(db, (client) => publishReport(client, args));
  const acc = await db.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM accounts WHERE id = $1 FOR UPDATE`, [args.accountId]);
  const run = await getRun(db, args.report.runId, { forUpdate: true });
  if (!run) return { accepted: false, reason: "missing_run" };
  if (run.account_id !== args.accountId) return { accepted: false, reason: "wrong_owner" };
  if (Object.keys(args.loaded).some((key) => args.report.basis[key as keyof RevisionBasis] !== args.loaded[key as keyof RevisionBasis])) {
    return { accepted: false, reason: "stale_report_basis" };
  }
  const current: RevisionBasis = {
    briefRevision: run.brief_revision,
    evidenceRevision: run.evidence_revision,
    consentEpoch: run.consent_epoch,
    cancellationEpoch: run.cancellation_epoch,
    workerLeaseFence: run.worker_lease_fence,
  };
  const consent = await currentConsent(db, args.accountId);
  // Reload evidence from storage: caller-supplied text/ownership/version is not authority.
  const stored = await db.query<{
    id: string; source_id: string; source_version_id: string; exact_text: string;
  }>(`SELECT p.id, v.source_id, p.source_version_id, p.exact_text
      FROM authorized_run_passages p JOIN source_versions v ON v.id = p.source_version_id
      JOIN sources s ON s.id = v.source_id
      WHERE p.run_id = $1
        AND p.account_id = $2 AND v.account_id = $2 AND s.account_id = $2`,
    [run.id, args.accountId]);
  const passages = stored.rows.map((p) => ({ id: p.id, sourceId: p.source_id,
    sourceVersionId: p.source_version_id, exactText: p.exact_text, locator: "document" }));
  const brief = await getBrief(db, run.brief_id);
  const evidence = await loadEvidence(db, run.id);
  const derivationContext = { constraints: brief.constraints, claims: args.claims,
    passages: evidence.passages.map((p) => ({ id: p.id, sourceId: p.source_id, sourceVersionId: p.source_version_id, exactText: p.exact_text, locator: "document" })),
    sources: evidence.sources.map((s) => ({ id: s.id, title: s.title, locator: s.canonical_locator,
      accessLevel: s.access_level, originCluster: s.origin_cluster ?? undefined, language: s.language ?? undefined })) };
  const scoped=await scopedPublicationClaims(db,{runId:run.id,accountId:args.accountId,briefRevision:run.brief_revision,evidenceRevision:args.report.basis.evidenceRevision,claims:args.claims});
  const calculations=await calculationPublicationClaims(db,{runId:run.id,accountId:args.accountId,briefRevision:run.brief_revision,evidenceRevision:args.report.basis.evidenceRevision,claims:args.claims});
  const rejected=new Set([...scoped.rejected,...calculations.rejected]);
  const problems = validateMaterialCitations({
    blocks: args.report.blocks, claims: args.claims, passages,
    runPassageIds: new Set(passages.map((p) => p.id)),
    derivationContext,scopedApprovals:scoped.approved,calculationApprovals:calculations.approved,rejectedScopedClaims:rejected,
  });
  const storedById = new Map(passages.map((p) => [p.id, p]));
  const alteredEvidence = args.passages.some((p) => {
    const persisted = storedById.get(p.id);
    return !persisted || persisted.sourceVersionId !== p.sourceVersionId ||
      persisted.sourceId !== p.sourceId || persisted.exactText !== p.exactText;
  });
  const deletedNow = args.deleted || !acc.rows[0] || Boolean(acc.rows[0].deleted_at);
  let reason = canPublish({
    loaded: args.loaded,
    current,
    deleted: deletedNow,
    unknownCitationIds: problems.unknownIds,
    unsupportedCitationCount: citationValidationFails(problems) || alteredEvidence ? 1 : 0,
    laterEvidenceDisclosed: args.report.outcome === "completed_with_limitations" && args.report.limitations.includes(LATER_EVIDENCE_LIMITATION),
  });
  if (reason === "ok" && (run.lifecycle === "cancelling" || run.cancellation_epoch > 0 && args.loaded.cancellationEpoch < run.cancellation_epoch)) {
    reason = "cancelled";
  }
  if (!deletedNow && (!consent || consent.revoked || consent.epoch !== args.loaded.consentEpoch)) reason = "consent_revoked";
  if (reason === "ok" && run.lifecycle === "terminal") return { accepted: false, reason: "already_published" };
  if(reason === "ok" && !(await reportCompletionCovered(db,args.accountId,args.report))) {
    await db.query("INSERT INTO publication_attempts(run_id,fence,accepted,reason) VALUES($1,$2,false,'incomplete_question_coverage')",
      [run.id,JSON.stringify({loaded:args.loaded,current})]);
    return {accepted:false,reason:"incomplete_question_coverage"};
  }
  await db.query(
    `INSERT INTO publication_attempts (run_id, fence, accepted, reason) VALUES ($1,$2,$3,$4)`,
    [args.report.runId, JSON.stringify({ loaded: args.loaded, current }), reason === "ok", reason],
  );
  if (reason !== "ok") return { accepted: false, reason };
  const checkedReport = await persistCheckedClaims(db, { report: args.report, accountId: args.accountId, claims: args.claims, passages, derivationContext, scopedApprovals:scoped.approved,calculationApprovals:calculations.approved });
  const changes=await deriveReportChanges(db,args.accountId,checkedReport);
  const changeSummary=changes.managed?changes.summary:args.report.changeSummary;
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
      JSON.stringify(checkedReport.blocks),
      checkedReport.claimIds,
      JSON.stringify(args.report.limitations),
      JSON.stringify(args.report.sourceAccessSummary),
      changeSummary ? JSON.stringify(changeSummary) : null,
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

/** Latest owned report blocks, published claims, and authorized passage exact texts. */
export async function loadOwnedExplanationEvidence(
  db: Queryable,
  args: { runId: string; accountId: string; report: { id: string; claim_ids?: string[]; blocks?: unknown } | null },
): Promise<{
  blocks: ReportBlock[];
  claims: { id: string; text: string; passageIds: string[] }[];
  passages: { id: string; exactText: string }[];
}> {
  if (!args.report) return { blocks: [], claims: [], passages: [] };
  const blocks = Array.isArray(args.report.blocks) ? (args.report.blocks as ReportBlock[]) : [];
  const passages = await db.query<{ id: string; exact_text: string }>(
    `SELECT p.id, p.exact_text
     FROM authorized_run_passages p
     JOIN source_versions v ON v.id = p.source_version_id
     JOIN sources s ON s.id = v.source_id
     WHERE p.run_id = $1 AND p.account_id = $2 AND v.account_id = $2 AND s.account_id = $2
       AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.account_id=$2 AND t.object_kind='source' AND t.object_id=s.id)`,
    [args.runId, args.accountId],
  );
  const claimIds = Array.isArray(args.report.claim_ids) ? args.report.claim_ids : [];
  const claims = claimIds.length
    ? await db.query<{ id: string; text: string; passage_ids: string[] }>(
        `SELECT c.id::text AS id, c.text,
           COALESCE(array_agg(e.passage_id::text) FILTER (WHERE e.passage_id IS NOT NULL AND e.decision = 'supports'), '{}') AS passage_ids
         FROM claims c
         LEFT JOIN claim_evidence e ON e.claim_id = c.id
         WHERE c.run_id = $1 AND c.account_id = $2 AND c.id::text = ANY($3::text[])
         GROUP BY c.id`,
        [args.runId, args.accountId, claimIds],
      )
    : { rows: [] };
  return {
    blocks,
    claims: claims.rows.map((c) => ({ id: c.id, text: c.text, passageIds: c.passage_ids ?? [] })),
    passages: passages.rows.map((p) => ({ id: p.id, exactText: p.exact_text })),
  };
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
  args: {
    accountId: string;
    reportId: string;
    claimId?: string;
    category: string;
    note?: string;
    includeExcerpt?: boolean;
    excerptText?: string | null;
  },
): Promise<string> {
  if (db instanceof pg.Pool) return withTx(db, (client) => insertChallenge(client, args));
  await lockActiveAccount(db, args.accountId);
  const report = await db.query("SELECT id FROM reports WHERE id=$1 AND account_id=$2 AND redacted_at IS NULL", [args.reportId, args.accountId]);
  if (!report.rows[0]) throw new Error("report_unavailable");
  if (args.claimId && !await reportOwnsClaim(db, args.reportId, args.accountId, args.claimId)) {
    throw Object.assign(new Error("Claim not found in this report."), { statusCode: 404 });
  }
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO challenges (id, account_id, report_id, claim_id, category, note, include_excerpt, excerpt_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      args.accountId,
      args.reportId,
      args.claimId ?? null,
      args.category,
      args.note ?? null,
      Boolean(args.includeExcerpt),
      args.includeExcerpt ? (args.excerptText ?? null) : null,
    ],
  );
  return id;
}

export async function reportOwnsClaim(db: Queryable, reportId: string, accountId: string, claimId: string): Promise<boolean> {
  const row = await db.query(`SELECT c.id FROM claims c JOIN reports r ON r.run_id=c.run_id AND r.account_id=c.account_id
    WHERE r.id=$1 AND r.account_id=$2 AND r.redacted_at IS NULL AND c.id::text=$3 AND c.id::text=ANY(r.claim_ids)`,
  [reportId, accountId, claimId]);
  return row.rowCount === 1;
}

export function excerptFromReport(report: { blocks?: unknown }, limit = 800): string {
  const blocks = Array.isArray(report.blocks) ? (report.blocks as { id?: string; text?: string }[]) : [];
  const answer = blocks.find((b) => b.id === "answer") ?? blocks[0];
  const text = String(answer?.text ?? "").trim();
  return text.slice(0, limit);
}
