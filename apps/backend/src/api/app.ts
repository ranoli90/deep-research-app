import Fastify, { type FastifyInstance } from "fastify";
import {
  CONSENT_POLICY_VERSION,
  CorrectionRequestSchema,
  CreateRunRequestSchema,
  DEFAULT_RUN_BUDGET_MICRO,
  MAX_ATTACHMENT_BYTES,
  PROCESSOR_DISCLOSURE,
} from "@deep/contracts";
import { applyCorrectionToConstraints, extractConstraints, impactForCorrection, parseCorrection, shouldFullRerun } from "@deep/research-core";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import { logError } from "../platform/log.js";
import {
  accountFromBearer,
  createDevSession,
  currentConsent,
  deleteAccount,
  grantConsent,
  revokeConsent,
} from "../modules/access.js";
import { reserveAllowance } from "../modules/billing.js";
import {
  cancelRun,
  emitEvent,
  findRunByIdempotency,
  getBrief,
  getRun,
  insertBrief,
  insertConversation,
  insertRun,
  listEvents,
  listLibrary,
} from "../modules/runs.js";
import { getPassageForAccount } from "../modules/evidence.js";
import { getLatestReportForRun, getReportForAccount, insertChallenge, publishReport } from "../modules/reports.js";
import { enqueueRun } from "../adapters/queue.js";

export type AppDeps = {
  pool: pg.Pool;
  config: AppConfig;
  boss: PgBoss;
};

function err(code: string, message: string, correlationId: string, preserved = "No additional changes.") {
  return { code, message, retryable: false, correlationId, preserved };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { pool, config, boss } = deps;

  app.get("/health", async () => ({ ok: true, mode: config.authMode, fixture: config.fixtureRouteAllowed, live: config.liveRouteEnabled }));
  app.get("/ready", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  app.post("/v1/dev/session", async (req, reply) => {
    if (config.authMode !== "development") {
      return reply.code(403).send(err("permission_denied", "Development sessions are disabled.", crypto.randomUUID()));
    }
    const body = (req.body ?? {}) as { email?: string };
    const session = await createDevSession(pool, body.email);
    return { accountId: session.accountId, token: session.token, labeled: "development-only" };
  });

  async function auth(req: { headers: Record<string, unknown> }) {
    return accountFromBearer(pool, String(req.headers.authorization ?? ""));
  }

  app.post("/v1/consent", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { grant?: boolean };
    if (body.grant === false) {
      const epoch = await revokeConsent(pool, a.accountId);
      return { granted: false, consentEpoch: epoch, processors: PROCESSOR_DISCLOSURE };
    }
    const r = await grantConsent(pool, a.accountId);
    return { granted: true, consentEpoch: r.epoch, policyVersion: CONSENT_POLICY_VERSION, processors: r.processors };
  });

  app.post("/v1/runs", async (req, reply) => {
    const correlationId = crypto.randomUUID();
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", correlationId));
    const parsed = CreateRunRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(err("invalid_input", parsed.error.issues[0]?.message ?? "invalid", correlationId));
    }
    const input = parsed.data;
    if (input.routeMode === "fixture" && !config.fixtureRouteAllowed) {
      return reply.code(403).send(err("permission_denied", "Fixture route is disabled.", correlationId));
    }
    if (input.routeMode === "controlled-research" && !config.liveRouteEnabled) {
      return reply.code(403).send(err("permission_denied", "Live route is not enabled. Missing authorized credentials/budget.", correlationId));
    }
    const consent = await currentConsent(pool, a.accountId);
    if (!consent || consent.revoked) {
      return reply.code(403).send(err("consent_required", "Grant AI processing consent before starting research.", correlationId, "Draft is preserved on device."));
    }
    const idempotencyKey = String(req.headers["idempotency-key"] ?? crypto.randomUUID());
    const existing = await findRunByIdempotency(pool, a.accountId, idempotencyKey);
    if (existing) {
      const brief = await getBrief(pool, existing.brief_id);
      if (brief.originalQuestion !== input.question || existing.route_mode !== input.routeMode) {
        return reply.code(409).send(err("idempotency_conflict", "Idempotency key was reused with a different request.", correlationId));
      }
      return { runId: existing.id, reused: true, lifecycle: existing.lifecycle, phase: existing.phase };
    }

    try {
      const created = await withTx(pool, async (c) => {
        const conversationId = input.conversationId ?? (await insertConversation(c, a.accountId, input.question));
        const constraints = extractConstraints(input.question);
        const briefId = crypto.randomUUID();
        const brief = {
          id: briefId,
          conversationId,
          originalQuestion: input.question,
          language: "en",
          attachmentIds: input.attachmentIds,
          sourceRestrictions: [],
          nonGoals: [],
          constraints,
          assumptions: [],
          budgetPolicyId: "default",
          consentPolicyVersion: CONSENT_POLICY_VERSION,
          revision: 1,
          outputPreferences: input.outputPreferences,
        };
        await insertBrief(c, brief, a.accountId);
        const runId = crypto.randomUUID();
        await insertRun(c, {
          id: runId,
          accountId: a.accountId,
          conversationId,
          briefId,
          parentRunId: input.parentRunId,
          routeMode: input.routeMode,
          briefRevision: 1,
          consentEpoch: consent.epoch,
          idempotencyKey,
          budgetMicro: DEFAULT_RUN_BUDGET_MICRO,
        });
        await reserveAllowance(c, a.accountId, runId, DEFAULT_RUN_BUDGET_MICRO);
        await emitEvent(c, {
          runId,
          accountId: a.accountId,
          type: "accepted",
          summary: "Research accepted. Closing the app will not stop the server job.",
          phase: "preparing",
        });
        return { runId, brief };
      });
      await enqueueRun(boss, created.runId);
      const run = await getRun(pool, created.runId);
      return {
        runId: created.runId,
        reused: false,
        lifecycle: run?.lifecycle,
        phase: run?.phase,
        routeMode: input.routeMode,
        constraints: created.brief.constraints,
        labeledDemo: input.routeMode === "fixture",
      };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23505") {
        const again = await findRunByIdempotency(pool, a.accountId, idempotencyKey);
        if (again) return { runId: again.id, reused: true, lifecycle: again.lifecycle, phase: again.phase };
      }
      if (code === "allowance_exhausted") {
        return reply.code(402).send(err("allowance_exhausted", "Not enough remaining allowance.", correlationId));
      }
      logError("create_run_failed", { correlationId, err: String(e) });
      return reply.code(500).send(err("internal_failure", "Could not accept the run.", correlationId));
    }
  });

  app.get("/v1/runs/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const brief = await getBrief(pool, run.brief_id);
    const report = await getLatestReportForRun(pool, run.id, a.accountId);
    return {
      runId: run.id,
      lifecycle: run.lifecycle,
      phase: run.phase,
      outcome: run.terminal_outcome,
      routeMode: run.route_mode,
      brief,
      revision: {
        briefRevision: run.brief_revision,
        evidenceRevision: run.evidence_revision,
        consentEpoch: run.consent_epoch,
        cancellationEpoch: run.cancellation_epoch,
      },
      reportId: report?.id ?? null,
      labeledDemo: run.route_mode === "fixture",
    };
  });

  app.get("/v1/runs/:id/events", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const after = Number((req.query as { after?: string }).after ?? 0);
    const events = await listEvents(pool, id, after);
    return {
      events: events.map((e) => ({
        id: e.id,
        runId: id,
        sequence: Number(e.sequence),
        type: e.type,
        publicSummary: e.public_summary,
        phase: e.phase,
        createdAt: e.created_at,
      })),
    };
  });

  app.post("/v1/runs/:id/cancel", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const updated = await cancelRun(pool, id);
    await emitEvent(pool, {
      runId: id,
      accountId: a.accountId,
      type: "cancel_requested",
      summary: "Stopping new work. An already-issued provider call may still finish accounting.",
      phase: updated?.phase ?? run.phase,
    });
    return { runId: id, lifecycle: updated?.lifecycle, cancellationEpoch: updated?.cancellation_epoch };
  });

  app.post("/v1/runs/:id/corrections", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const parsed = CorrectionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(err("invalid_input", "Invalid correction.", crypto.randomUUID()));
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    if (run.brief_revision !== parsed.data.expectedBriefRevision) {
      return reply.code(409).send(err("stale_revision", "This correction is based on an older brief.", crypto.randomUUID()));
    }
    const consent = await currentConsent(pool, a.accountId);
    if (!consent || consent.revoked) {
      return reply.code(403).send(err("consent_required", "Consent required.", crypto.randomUUID()));
    }
    const parentBrief = await getBrief(pool, run.brief_id);
    const parsedCorrection = parseCorrection(parsed.data.correctionText);
    const applied = applyCorrectionToConstraints(parentBrief.constraints, parsed.data.correctionText);
    const impact = impactForCorrection({
      previousConstraints: parentBrief.constraints,
      nextConstraints: applied.next,
      reopenedDiscovery: applied.reopenedDiscovery,
      dependencyCompleteness: parsedCorrection.unknownDependencies ? "unknown" : applied.reopenedDiscovery ? "unknown" : "partial",
    });
    const fullRerun = shouldFullRerun(impact);
    const created = await withTx(pool, async (c) => {
      const briefId = crypto.randomUUID();
      const revision = parentBrief.revision + 1;
      const brief = {
        ...parentBrief,
        id: briefId,
        originalQuestion: `${parentBrief.originalQuestion}\n\nCorrection: ${parsed.data.correctionText}`,
        constraints: applied.next,
        revision,
      };
      await insertBrief(c, brief, a.accountId);
      const childId = crypto.randomUUID();
      const key = `corr-${id}-${revision}-${createHash("sha256").update(parsed.data.correctionText).digest("hex").slice(0, 12)}`;
      await insertRun(c, {
        id: childId,
        accountId: a.accountId,
        conversationId: run.conversation_id,
        briefId,
        parentRunId: run.id,
        routeMode: run.route_mode,
        briefRevision: revision,
        consentEpoch: consent.epoch,
        idempotencyKey: key,
        budgetMicro: DEFAULT_RUN_BUDGET_MICRO,
      });
      await reserveAllowance(c, a.accountId, childId, DEFAULT_RUN_BUDGET_MICRO);
      await emitEvent(c, {
        runId: childId,
        accountId: a.accountId,
        type: "correction_accepted",
        summary: applied.reopenedDiscovery
          ? "Correction relaxes a hard constraint; candidate discovery will reopen."
          : fullRerun
            ? "Dependency completeness is not known; running a bounded full rerun."
            : "Correction accepted; affected conclusions will be recomputed.",
        phase: "preparing",
        payload: { ...impact, fullRerun },
      });
      return { childId, brief, impact, fullRerun };
    });
    await enqueueRun(boss, created.childId);
    return { runId: created.childId, parentRunId: id, impact: created.impact, fullRerun: created.fullRerun, briefRevision: created.brief.revision };
  });

  app.get("/v1/reports/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const report = await getReportForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (!report) return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
    return {
      reportId: report.id,
      runId: report.run_id,
      version: report.version,
      outcome: report.outcome,
      blocks: report.blocks,
      limitations: report.limitations,
      sourceAccessSummary: report.source_access_summary,
      changeSummary: report.change_summary,
      routeMode: report.route_mode,
      labeledDemo: report.route_mode === "fixture",
    };
  });

  app.get("/v1/sources/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const row = await getPassageForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (!row) return reply.code(404).send(err("permission_denied", "Source not found.", crypto.randomUUID()));
    return {
      passageId: row.id,
      title: row.title,
      locator: row.canonical_locator,
      publisher: row.publisher,
      originCluster: row.origin_cluster,
      accessLevel: row.access_level,
      exactText: row.exact_text,
      labeledDemo: true,
    };
  });

  app.get("/v1/library", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { items: await listLibrary(pool, a.accountId) };
  });

  app.post("/v1/reports/:id/challenges", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const report = await getReportForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (!report) return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { claimId?: string; category?: string; note?: string };
    const id = await insertChallenge(pool, {
      accountId: a.accountId,
      reportId: report.id,
      claimId: body.claimId,
      category: body.category ?? "claim",
      note: body.note,
    });
    return { challengeId: id };
  });

  app.get("/v1/reports/:id/export", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const report = await getReportForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (!report) return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
    const blocks = report.blocks as { text: string; citationIds?: string[] }[];
    const md = blocks
      .map((b) => {
        const cites = (b.citationIds ?? []).map((c) => `[${c.slice(0, 8)}]`).join("");
        return `${b.text}${cites ? " " + cites : ""}`;
      })
      .join("\n\n");
    return { format: "markdown", markdown: md };
  });

  app.post("/v1/attachments", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { filename?: string; mime?: string; text?: string };
    const text = body.text ?? "";
    const mime = body.mime ?? "text/plain";
    if (!["text/plain", "text/markdown", "application/pdf"].includes(mime)) {
      return reply.code(400).send(err("invalid_input", "Only text, Markdown, and PDF are supported.", crypto.randomUUID()));
    }
    const buf = Buffer.from(text, "utf8");
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return reply.code(400).send(err("invalid_input", "File exceeds size limit.", crypto.randomUUID()));
    }
    const id = crypto.randomUUID();
    await mkdir(config.storageDir, { recursive: true });
    const ptr = join(config.storageDir, `${a.accountId}-${id}`);
    await writeFile(ptr, buf);
    await pool.query(
      `INSERT INTO attachments (id, account_id, filename, mime, size_bytes, storage_ptr, sha256, processing_state, extracted_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'extracted',$8)`,
      [id, a.accountId, body.filename ?? "note.txt", mime, buf.length, ptr, createHash("sha256").update(buf).digest("hex"), mime === "application/pdf" ? text : text],
    );
    return { attachmentId: id, processingState: "extracted", coverage: mime === "application/pdf" ? "text-only" : "complete" };
  });

  app.post("/v1/account/deletion", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    await withTx(pool, async (c) => {
      await deleteAccount(c, a.accountId);
    });
    return {
      deleted: true,
      note: "Active research is cancelled. Private derived text is removed. Store subscriptions are a separate action.",
    };
  });

  app.get("/v1/settings", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const consent = await currentConsent(pool, a.accountId);
    const allow = await pool.query(`SELECT * FROM allowance_accounts WHERE account_id = $1`, [a.accountId]);
    return {
      consent,
      processors: PROCESSOR_DISCLOSURE,
      allowance: allow.rows[0] ?? null,
      liveRouteEnabled: config.liveRouteEnabled,
      fixtureRouteAllowed: config.fixtureRouteAllowed,
      purchases: { available: false, reason: "Store purchases are gated until sandbox credentials exist." },
      push: { available: false, reason: "Live push is gated; reopen the app to refresh research." },
    };
  });

  // Test-only publish helper is not exposed. Tests import publishReport.
  void publishReport;
  return app;
}
