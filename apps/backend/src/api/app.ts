import { RequestedVerificationRequestSchema } from "@deep/contracts";
import { admitRequestedVerification } from "../modules/requested-verification.js";
import { admitResearchCorrection,resolveResearchCorrection } from "../modules/research-corrections.js";
import { deleteSourceForAccount } from "../modules/source-deletion.js";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import {
  CONSENT_POLICY_VERSION,
  CorrectionRequestSchema,
  CreateRunRequestSchema,
  DEFAULT_RUN_BUDGET_MICRO,
  DELETION_VS_SUBSCRIPTION,
  MAX_ATTACHMENT_BYTES,
  OUTPUT_REPORT_CATEGORIES,
  PRIVACY_DATA_FLOWS,
  PROCESSOR_DISCLOSURE,
} from "@deep/contracts";
import {
  applyCorrectionToConstraints,
  extractConstraints,
  impactForCorrection,
  inferOutputPreference,
  parseCorrection,
  routeFollowUp,
  shouldFullRerun,
} from "@deep/research-core";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { createHash } from "node:crypto";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import { exportReportForAccount } from "../modules/report-export.js";
import { logError } from "../platform/log.js";
import {
  accountFromBearer,
  createDevSession,
  currentConsent,
  deleteAccount,
  grantConsent,
  lockActiveAccount,
  revokeConsent,
} from "../modules/access.js";
import { reserveAllowance } from "../modules/billing.js";
import { pinRouteCapabilities } from "../modules/route-capabilities.js";
import { toPublicActivity } from "../modules/public-activity.js";
import { measureRunCost } from "../modules/run-cost.js";
import {
  cancelOwnedRun,
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
import { excerptFromReport, getLatestReportForRun, getReportForAccount, insertChallenge, publishReport, reportOwnsClaim } from "../modules/reports.js";
import { tryDispatchRun } from "../modules/run-dispatch.js";
import { admitRun } from "../modules/run-admission.js";
import { approveQueryAuthorization, pendingQueryAuthorization } from "../modules/retrieval-intelligence.js";
import { modelPolicy } from "../ports/model-policy.js";
import { z } from "zod";
import { resolveAdmission, VerificationRecoverySchema } from "../modules/admission-recovery.js";
import { attachmentUploadReceipt, AttachmentUploadConflict, storeAttachment, validateAttachmentBytes } from "../modules/attachments.js";
import { drainFileDeletions } from "../modules/file-deletion.js";
import { verifySupabaseIdentity } from "../adapters/auth/supabase.js";
import { accountForIdentity } from "../modules/identity.js";

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
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES }, (_req, body, done) => done(null, body));
  const { pool, config, boss } = deps;
  const typedCorrectionsEnabled=Boolean(config.structuredModelEnabled&&config.liveRouteEnabled&&config.openRouterApiKey&&config.liveSpendCapMicro>0&&(config.liveKeySpendCapMicro??0)>0);

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, String(body));
  });

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
    const header = String(req.headers.authorization ?? "");
    if (config.authMode === "development") return accountFromBearer(pool, header);
    if (!config.supabaseAuth || !header.startsWith("Bearer ")) return null;
    const identity = await verifySupabaseIdentity(header.slice(7).trim(), config.supabaseAuth);
    if (identity.status === "unavailable") throw Object.assign(new Error("Sign-in verification is temporarily unavailable."), { statusCode: 503 });
    if (identity.status !== "verified") return null;
    return accountForIdentity(pool, identity.identity);
  }

  app.get("/v1/session", async (req, reply) => {
    const account = await auth(req as never);
    if (!account || account.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { accountId: account.accountId, authMode: config.authMode };
  });

  app.post("/v1/consent", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { grant?: boolean };
    if (typeof body.grant !== "boolean") {
      return reply.code(400).send(err("invalid_input", "An explicit consent choice is required.", crypto.randomUUID()));
    }
    if (body.grant === false) {
      const epoch = await revokeConsent(pool, a.accountId);
      return { granted: false, consentEpoch: epoch, processors: PROCESSOR_DISCLOSURE };
    }
    const r = await grantConsent(pool, a.accountId);
    return { granted: true, consentEpoch: r.epoch, policyVersion: CONSENT_POLICY_VERSION, processors: r.processors };
  });

  app.post("/v1/run-requests/resolve", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const input = z.object({ idempotencyKey: z.string().uuid(), verification: VerificationRecoverySchema.optional() }).strict().safeParse(req.body);
    if (!input.success) return reply.code(400).send(err("invalid_input", "Saved request key required.", crypto.randomUUID()));
    const resolved = await resolveAdmission(pool, a.accountId, input.data.idempotencyKey, input.data.verification);
    if (!resolved) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return resolved;
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
    if (input.routeMode === "controlled-research" && config.nodeEnv === "production" && !config.structuredModelEnabled) {
      return reply.code(403).send(err("permission_denied", "Structured research is disabled.", correlationId));
    }
    if (input.routeMode === "controlled-research") {
      if (!config.openRouterApiKey || config.liveSpendCapMicro <= 0) {
        return reply.code(403).send(err("permission_denied", "Live route requires OPENROUTER_API_KEY and LIVE_SPEND_CAP_MICRO>0.", correlationId));
      }
      const { liveSpendUsedMicro, canIssueLiveCall } = await import("../modules/live-spend.js");
      const used = await liveSpendUsedMicro(pool);
      const gate = canIssueLiveCall({ capMicro: config.liveSpendCapMicro, usedMicro: used });
      if (!gate.ok) {
        return reply.code(403).send(err("allowance_exhausted", "Live spend cap would be exceeded. No new paid call issued.", correlationId));
      }
    }
    const consent = await currentConsent(pool, a.accountId);
    if (!consent || consent.revoked) {
      return reply.code(403).send(err("consent_required", "Grant AI processing consent before starting research.", correlationId, "Draft is preserved on device."));
    }
    const idempotencyKey = String(req.headers["idempotency-key"] ?? crypto.randomUUID());
    try {
      const created = await admitRun(pool, a.accountId, idempotencyKey, input, {
        strategy: config.structuredStrategy,
        modelPolicyId: config.structuredModelPolicyId,
        zdrRequired: config.structuredModelPolicyId ? modelPolicy(config.structuredModelPolicyId).provider === "azure" : false,
      });
      await tryDispatchRun(pool, boss, created.runId);
      const run = await getRun(pool, created.runId);
      return {
        runId: created.runId,
        reused: created.reused,
        lifecycle: run?.lifecycle,
        phase: run?.phase,
        routeMode: input.routeMode,
        constraints: created.brief.constraints,
        labeledDemo: input.routeMode === "fixture",
      };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "idempotency_conflict" || code === "stale_revision" || code === "idempotency_withdrawn") {
        return reply.code(409).send(err(code, "Request conflicts with the accepted revision or idempotency key.", correlationId));
      }
      if (code === "permission_denied" || code === "consent_required") {
        return reply.code(403).send(err(code, "Run inputs are not authorized for this account and consent.", correlationId));
      }
      if (code === "allowance_exhausted" || code === "attempt_budget_exhausted") {
        return reply.code(402).send(err("allowance_exhausted", "Not enough remaining allowance.", correlationId));
      }
      if (code === "no_admitted_route" || code === "zdr_incompatible_unavailable" || code === "structured_output_required" || code === "candidate_unavailable" || code === "privacy_incompatible_unavailable" || code === "model_policy_mismatch") {
        return reply.code(403).send(err(code, "No privacy-admitted model route is available for this run.", correlationId));
      }
      logError("create_run_failed", { correlationId, err: String(e) });
      return reply.code(500).send(err("internal_failure", "Could not accept the run.", correlationId));
    }
  });

  app.get("/v1/runs/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const brief = await getBrief(pool, run.brief_id);
    const report = await getLatestReportForRun(pool, run.id, a.accountId);
    const contentInvalidated = Boolean((await pool.query(
      "SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion' LIMIT 1",
      [a.accountId, run.id],
    )).rowCount);
    const pendingQuery = await pendingQueryAuthorization(pool, { accountId: a.accountId, runId: run.id, briefRevision: run.brief_revision });
    return {
      runId: run.id,
      contentInvalidated,
      lifecycle: run.lifecycle,
      phase: run.phase,
      outcome: run.terminal_outcome,
      routeMode: run.route_mode,
      correctionMode:run.route_mode==="fixture"&&config.fixtureRouteAllowed?"legacy":typedCorrectionsEnabled&&run.route_mode==="controlled-research"?"replace_question":"unavailable",
      correctionReserveMicro:DEFAULT_RUN_BUDGET_MICRO,
      brief,
      pendingQueryAuthorization: pendingQuery,
      revision: {
        briefRevision: run.brief_revision,
        evidenceRevision: run.evidence_revision,
        consentEpoch: run.consent_epoch,
        cancellationEpoch: run.cancellation_epoch,
      },
      reportId: contentInvalidated ? null : report?.id ?? null,
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
      events: events.map((e) => {
        const activity = toPublicActivity({
          type: e.type,
          publicSummary: e.public_summary,
          phase: e.phase,
          createdAt: String(e.created_at),
        });
        return {
          id: e.id,
          runId: id,
          sequence: Number(e.sequence),
          type: e.type,
          publicSummary: e.public_summary,
          phase: e.phase,
          createdAt: e.created_at,
          activity,
        };
      }),
    };
  });

  app.post("/v1/runs/:id/cancel", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const updated = await cancelOwnedRun(pool, a.accountId, id);
    if (!updated) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    return { runId: id, lifecycle: updated.lifecycle, cancellationEpoch: updated.cancellation_epoch };
  });

  app.post("/v1/runs/:id/continue", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    if (run.lifecycle !== "awaiting_input") {
      return reply.code(409).send(err("stale_revision", "This run is not waiting for input.", crypto.randomUUID()));
    }
    const body = (req.body ?? {}) as { geography?: string; answers?: { field?: string; value?: string }[] };
    const answers = [
      ...(body.answers ?? []).map((a) => ({ field: String(a.field ?? "").trim(), value: String(a.value ?? "").trim() })),
      ...(body.geography ? [{ field: "geography", value: body.geography.trim() }] : []),
    ].filter((a) => a.field && a.value);
    if (!answers.length) {
      return reply.code(400).send(err("invalid_input", "A material clarification answer is required to continue.", crypto.randomUUID()));
    }
    const brief = await getBrief(pool, run.brief_id);
    for (const answer of answers) {
      brief.constraints = [
        ...brief.constraints.filter((c) => c.field !== answer.field),
        {
          id: `${answer.field}-${answer.value.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`,
          field: answer.field,
          operator: "eq",
          value: answer.value.toLowerCase(),
          origin: "confirmed",
          importance: "hard",
          explanation: "Supplied after clarification",
        },
      ];
    }
    await withTx(pool, async (db) => {
    await lockActiveAccount(db, a.accountId);
    const current = await getRun(db, id, { forUpdate: true });
    if (!current || current.account_id !== a.accountId || current.lifecycle !== "awaiting_input" || current.brief_revision !== run.brief_revision) {
      throw Object.assign(new Error("This run is no longer waiting for this input."), { statusCode: 409 });
    }
    await db.query(`UPDATE research_briefs SET payload = $2 WHERE id = $1`, [brief.id, JSON.stringify(brief)]);
    await db.query(`UPDATE runs SET lifecycle = 'queued', phase = 'preparing', updated_at = now() WHERE id = $1`, [id]);
    await db.query(`INSERT INTO run_dispatch_outbox (run_id) VALUES ($1)
      ON CONFLICT (run_id) DO UPDATE SET state = 'pending', attempt_id = NULL,
        lease_until = NULL, next_attempt_at = now()`, [id]);
    await emitEvent(db, {
      runId: id,
      accountId: a.accountId,
      type: "clarification_answered",
      summary: "Clarification recorded. Research will continue.",
      phase: "preparing",
    });
    });
    await tryDispatchRun(pool, boss, id);
    return { runId: id, lifecycle: "queued" };
  });

  app.post("/v1/runs/:id/assumptions", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { action?: string; values?: string[] };
    const action = body.action === "replace" ? "replace" : "confirm";
    const values = Array.isArray(body.values) ? body.values.map((v) => String(v).trim()).filter(Boolean).slice(0, 12) : [];
    if (action === "replace" && !values.length) {
      return reply.code(400).send(err("invalid_input", "Replacement assumptions cannot be empty.", crypto.randomUUID()));
    }
    try {
      await withTx(pool, async (db) => {
        await lockActiveAccount(db, a.accountId);
        const run = await getRun(db, id, { forUpdate: true });
        if (!run || run.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
        const brief = await getBrief(db, run.brief_id);
        const current = Array.isArray(brief.assumptions) ? brief.assumptions : [];
        const next = action === "replace"
          ? values.map((value, index) => ({
              ...(typeof current[index] === "object" && current[index] ? current[index] : { id: `assumption-${index}` }),
              value,
              userConfirmationState: "confirmed",
            }))
          : current.map((item) => ({ ...item, userConfirmationState: "confirmed" }));
        await db.query(`UPDATE research_briefs SET payload = $2 WHERE id = $1`, [brief.id, JSON.stringify({ ...brief, assumptions: next })]);
        await emitEvent(db, {
          runId: id,
          accountId: a.accountId,
          type: "clarification_answered",
          summary: action === "replace" ? "Assumptions updated." : "Assumptions confirmed.",
          phase: "preparing",
        });
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      throw e;
    }
    return { runId: id, action };
  });

  app.post("/v1/runs/:id/query-authorizations/approve", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { authorizationId?: string; queryDigest?: string; terms?: string[] };
    const authorizationId = String(body.authorizationId ?? "").trim();
    const queryDigest = String(body.queryDigest ?? "").trim();
    const terms = Array.isArray(body.terms) ? body.terms.map((t) => String(t).trim()).filter(Boolean) : [];
    if (!authorizationId || !queryDigest) {
      return reply.code(400).send(err("invalid_input", "Exact query authorization id and digest are required.", crypto.randomUUID()));
    }
    try {
      const result = await withTx(pool, async (db) => {
        await lockActiveAccount(db, a.accountId);
        const run = await getRun(db, id, { forUpdate: true });
        if (!run || run.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
        const approved = await approveQueryAuthorization(db, {
          accountId: a.accountId,
          runId: id,
          briefRevision: run.brief_revision,
          authorizationId,
          queryDigest,
          terms,
        });
        if (!approved.ok) throw Object.assign(new Error(approved.reason), { statusCode: 409, code: approved.reason });
        if (run.lifecycle === "awaiting_input") {
          await db.query(`UPDATE runs SET lifecycle='queued', phase='preparing', updated_at=now() WHERE id=$1`, [id]);
          await db.query(`INSERT INTO run_dispatch_outbox (run_id) VALUES ($1)
            ON CONFLICT (run_id) DO UPDATE SET state = 'pending', attempt_id = NULL,
              lease_until = NULL, next_attempt_at = now()`, [id]);
        }
        await emitEvent(db, {
          runId: id,
          accountId: a.accountId,
          type: "clarification_answered",
          summary: "Public search terms were approved for this research only.",
          phase: "preparing",
        });
        return { lifecycle: run.lifecycle === "awaiting_input" ? "queued" : run.lifecycle };
      });
      await tryDispatchRun(pool, boss, id);
      return { runId: id, ...result };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 500;
      const code = (e as { code?: string }).code ?? "permission_denied";
      if (status === 404) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      if (status === 409) return reply.code(409).send(err(code, "This approval does not match the pending query.", crypto.randomUUID()));
      throw e;
    }
  });

  app.post("/v1/runs/:id/corrections/resolve", async (req,reply) => {
    const a=await auth(req as never);
    if(!a||a.deleted)return reply.code(401).send(err("permission_denied","Sign in required.",crypto.randomUUID()));
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);
    const input=CorrectionRequestSchema.strict().safeParse(req.body);
    if(!id.success||!input.success||!input.data.patch)return reply.code(400).send(err("invalid_input","Exact saved typed correction required.",crypto.randomUUID()));
    const result=await resolveResearchCorrection(pool,a.accountId,id.data,input.data);
    if(!result)return reply.code(401).send(err("permission_denied","Sign in required.",crypto.randomUUID()));
    return result;
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
    if(run.route_mode==="fixture"&&!config.fixtureRouteAllowed)return reply.code(409).send(err("invalid_input","Demo corrections are disabled.",crypto.randomUUID()));
    if(parsed.data.patch) {
      if(!typedCorrectionsEnabled||run.route_mode!=="controlled-research")return reply.code(409).send(err("invalid_input","Structured corrections are unavailable on this route.",crypto.randomUUID()));
      const created=await admitResearchCorrection(pool,a.accountId,id,parsed.data);
      await tryDispatchRun(pool,boss,created.runId);
      return created;
    }
    const parentBrief = await getBrief(pool, run.brief_id);
    const parsedCorrection = parseCorrection(parsed.data.correctionText);
    const applied = applyCorrectionToConstraints(parentBrief.constraints, parsed.data.correctionText);
    const impact = impactForCorrection({
      previousConstraints: parentBrief.constraints,
      nextConstraints: applied.next,
      reopenedDiscovery: applied.reopenedDiscovery,
      dependencyCompleteness: parsedCorrection.unknownDependencies ? "unknown" : "known",
    });
    const fullRerun = shouldFullRerun(impact);
    const created = await withTx(pool, async (c) => {
      await lockActiveAccount(c, a.accountId);
      const authorizedConsent = await currentConsent(c, a.accountId);
      if (!authorizedConsent || authorizedConsent.revoked || authorizedConsent.epoch !== consent.epoch) {
        throw Object.assign(new Error("Consent required."), { statusCode: 403 });
      }
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
    await tryDispatchRun(pool, boss, created.childId);
    return { runId: created.childId, parentRunId: id, impact: created.impact, fullRerun: created.fullRerun, briefRevision: created.brief.revision };
  });

  app.post("/v1/runs/:id/follow-up", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const followBody = (req.body ?? {}) as { claimId?: string; note?: string; message?: string };
    if (!followBody.claimId && followBody.message) {
      const routed = routeFollowUp(followBody.message, {
        reportReady: true,
        runActive: run.lifecycle !== "terminal",
      });
      if (routed.kind === "explain" && !routed.mutatesBrief) {
        return { kind: "explain", runId: id, reason: routed.reason, mutatesBrief: false };
      }
    }
    if(run.route_mode==="controlled-research"){
      const parsed=RequestedVerificationRequestSchema.safeParse(req.body);
      if(!parsed.success)return reply.code(400).send(err("invalid_input","A current report, selected claim and verification request are required.",crypto.randomUUID()));
      const created=await admitRequestedVerification(pool,config,a.accountId,id,parsed.data);
      await tryDispatchRun(pool,boss,created.runId);return created;
    }
    const consent = await currentConsent(pool, a.accountId);
    if (!consent || consent.revoked) {
      return reply.code(403).send(err("consent_required", "Consent required.", crypto.randomUUID()));
    }
    const body = (req.body ?? {}) as { claimId?: string; note?: string };
    const parentBrief = await getBrief(pool, run.brief_id);
    const created = await withTx(pool, async (c) => {
      await lockActiveAccount(c, a.accountId);
      const authorizedConsent = await currentConsent(c, a.accountId);
      if (!authorizedConsent || authorizedConsent.revoked || authorizedConsent.epoch !== consent.epoch) {
        throw Object.assign(new Error("Consent required."), { statusCode: 403 });
      }
      const briefId = crypto.randomUUID();
      const revision = parentBrief.revision + 1;
      const brief = {
        ...parentBrief,
        id: briefId,
        originalQuestion: `${parentBrief.originalQuestion}\n\nFollow-up: verify only ${body.claimId ?? "the named claim"}. ${body.note ?? ""}`.trim(),
        revision,
      };
      const parentReport = await getLatestReportForRun(c, run.id, a.accountId);
      if (typeof body.claimId !== "string" || !parentReport || !await reportOwnsClaim(c, parentReport.id, a.accountId, body.claimId)) {
        throw Object.assign(new Error("Claim not found in the current report."), { statusCode: 404 });
      }
      await insertBrief(c, brief, a.accountId);
      const childId = crypto.randomUUID();
      await insertRun(c, {
        id: childId,
        accountId: a.accountId,
        conversationId: run.conversation_id,
        briefId,
        parentRunId: run.id,
        routeMode: run.route_mode,
        briefRevision: revision,
        consentEpoch: consent.epoch,
        idempotencyKey: `follow-${id}-${revision}-${createHash("sha256").update(body.note ?? body.claimId ?? "claim").digest("hex").slice(0, 12)}`,
        budgetMicro: DEFAULT_RUN_BUDGET_MICRO,
      });
      await reserveAllowance(c, a.accountId, childId, DEFAULT_RUN_BUDGET_MICRO);
      await emitEvent(c, {
        runId: childId,
        accountId: a.accountId,
        type: "follow_up_accepted",
        summary: "A diagnostic research rerun was requested. This route does not establish targeted claim verification.",
        phase: "preparing",
        payload: { claimId: body.claimId ?? null, reopenedDiscovery: true, verificationMode: "diagnostic_research" },
      });
      return { childId, revision };
    });
    await tryDispatchRun(pool, boss, created.childId);
    return { runId: created.childId, parentRunId: id, briefRevision: created.revision, reopenedDiscovery: true, verificationMode: "diagnostic_research" };
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
      sourceId: row.source_id,
      title: row.title,
      locator: row.canonical_locator,
      publisher: row.publisher,
      originCluster: row.origin_cluster,
      originRelation: row.origin_relation ?? null,
      publicationDate: row.publication_date ? String(row.publication_date).slice(0, 10) : null,
      retrievedAt: row.retrieved_at ? new Date(row.retrieved_at).toISOString() : null,
      accessLevel: row.access_level,
      exactText: row.exact_text,
      passageLocator: row.locator,
      sourceVersionId: row.source_version_id,
      extractionMethod: row.extraction_method,
      coverage: row.text_coverage,
      warnings: row.quality_warnings,
      labeledDemo: row.route_mode === "fixture",
    };
  });

  app.delete("/v1/sources/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const result = await deleteSourceForAccount(pool, a.accountId, (req.params as { id: string }).id);
    try { await drainFileDeletions(pool, config.storageDir, a.accountId); }
    catch { logError("file_deletion_deferred", { reason: "database_or_storage_unavailable" }); }
    const pending = await pool.query("SELECT 1 FROM file_deletion_outbox WHERE account_id=$1 AND state <> 'deleted' LIMIT 1", [a.accountId]);
    return { ...result, fileCleanupPending: pending.rowCount !== 0 };
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
    const body = (req.body ?? {}) as {
      claimId?: string;
      category?: string;
      note?: string;
      includeExcerpt?: boolean;
    };
    const category = body.category ?? "other";
    if (!(OUTPUT_REPORT_CATEGORIES as readonly string[]).includes(category) && category !== "claim") {
      return reply.code(400).send(err("invalid_input", "Unknown report category.", crypto.randomUUID()));
    }
    const includeExcerpt = body.includeExcerpt === true;
    const excerptText = includeExcerpt ? excerptFromReport(report) : null;
    const id = await insertChallenge(pool, {
      accountId: a.accountId,
      reportId: report.id,
      claimId: body.claimId,
      category,
      note: body.note,
      includeExcerpt,
      excerptText,
    });
    return { challengeId: id, submitted: true, includedExcerpt: includeExcerpt };
  });

  app.get("/v1/reports/:id/export", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const md = await exportReportForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (md === null) return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
    return { format: "markdown", markdown: md };
  });

  app.post("/v1/attachments", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const parsed = z.object({ filename: z.string().min(1).max(180).default("note.txt"),
      mime: z.enum(["text/plain", "text/markdown"]).default("text/plain"), text: z.string().min(1).max(1_000_000) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(err("invalid_input", "Paste text/Markdown notes here; PDF requires a binary file upload.", crypto.randomUUID()));
    const { filename, mime, text } = parsed.data;
    const bytes = Buffer.from(text, "utf8");
    try { validateAttachmentBytes(bytes, mime, filename); }
    catch { return reply.code(400).send(err("invalid_input", "Invalid file name, text or size.", crypto.randomUUID())); }
    const key = z.string().uuid().optional().safeParse(req.headers["idempotency-key"]);
    if (!key.success) return reply.code(400).send(err("invalid_input", "Upload request key must be a UUID.", crypto.randomUUID()));
    let id: string | null;
    try { id = await storeAttachment(pool, { accountId: a.accountId, filename, mime, bytes, extractedText: text, idempotencyKey: key.data }); }
    catch (error) {
      if (error instanceof AttachmentUploadConflict) return reply.code(409).send(err("idempotency_conflict", "Upload request was already used for different or deleted content.", crypto.randomUUID()));
      throw error;
    }
    if (!id) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const receipt = await attachmentUploadReceipt(pool, a.accountId, id);
    if (!receipt) return reply.code(404).send(err("permission_denied", "File is unavailable.", crypto.randomUUID()));
    return receipt;
  });

  app.post("/v1/attachments/bytes", { bodyLimit: MAX_ATTACHMENT_BYTES }, async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const mime = req.headers["x-document-mime"], encodedName = req.headers["x-file-name"];
    if (!Buffer.isBuffer(req.body) || typeof mime !== "string" || typeof encodedName !== "string")
      return reply.code(400).send(err("invalid_input", "Binary body and file metadata required.", crypto.randomUUID()));
    let filename: string;
    try { filename = decodeURIComponent(encodedName); validateAttachmentBytes(req.body, mime, filename); }
    catch { return reply.code(400).send(err("invalid_input", "Unsupported or invalid file bytes, name or size.", crypto.randomUUID())); }
    const key = z.string().uuid().optional().safeParse(req.headers["idempotency-key"]);
    if (!key.success) return reply.code(400).send(err("invalid_input", "Upload request key must be a UUID.", crypto.randomUUID()));
    let id: string | null;
    try { id = await storeAttachment(pool, { accountId: a.accountId, filename, mime, bytes: req.body, idempotencyKey: key.data }); }
    catch (error) {
      if (error instanceof AttachmentUploadConflict) return reply.code(409).send(err("idempotency_conflict", "Upload request was already used for different or deleted content.", crypto.randomUUID()));
      throw error;
    }
    if (!id) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const receipt = await attachmentUploadReceipt(pool, a.accountId, id);
    if (!receipt) return reply.code(404).send(err("permission_denied", "File is unavailable.", crypto.randomUUID()));
    return reply.code(201).send(receipt);
  });

  app.get("/v1/attachments/:id", async (req, reply) => {
    const a = await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send(err("invalid_input", "File not found.", crypto.randomUUID()));
    const result = await pool.query("SELECT id,filename,mime,size_bytes,processing_state,extraction->'warnings' AS warnings FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL", [id.data, a.accountId]);
    if (!result.rows[0]) return reply.code(404).send(err("permission_denied", "File not found.", crypto.randomUUID()));
    return result.rows[0];
  });

  app.get("/account/deletion", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Delete Deep Research account</title></head>
<body>
<h1>Delete account and derived research</h1>
<p>This page works in a browser. You do not need to reinstall the app. Paste a current session token. Active research is cancelled. Private derived text is removed. Store subscriptions are a separate action.</p>
<form method="post" action="/account/deletion">
<label>Session token <input type="password" name="token" autocomplete="off" required/></label>
<button type="submit">Delete account and derived research</button>
</form>
</body></html>`);
  });

  async function performDeletion(a: { accountId: string } | null, reply: FastifyReply, asHtml: boolean) {
    if (!a) {
      if (asHtml) {
        reply.header("content-type", "text/html; charset=utf-8");
        return reply.code(401).send("<!doctype html><p>Sign in required. Open this page from the app or paste a valid session token.</p>");
      }
      return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    }
    await withTx(pool, async (c) => {
      await deleteAccount(c, a.accountId);
    });
    // Storage work happens after commit. A durable worker retries outages and lost acknowledgements.
    try { await drainFileDeletions(pool, config.storageDir, a.accountId); }
    catch { logError("file_deletion_deferred", { reason: "database_or_storage_unavailable" }); }
    const pending = await pool.query("SELECT 1 FROM file_deletion_outbox WHERE account_id=$1 AND state <> 'deleted' LIMIT 1", [a.accountId]);
    const fileCleanupPending = pending.rowCount !== 0;
    if (asHtml) {
      reply.header("content-type", "text/html; charset=utf-8");
      return reply.send(`<!doctype html><p>Account deleted. Active research was cancelled. Private derived text was removed.${fileCleanupPending ? " Stored file deletion is queued and will retry." : ""}</p>`);
    }
    return {
      deleted: true,
      fileCleanupPending,
      note: "Active research is cancelled. Private derived text is removed. Store subscriptions are a separate action.",
    };
  }

  app.post("/account/deletion", async (req, reply) => {
    const raw = typeof req.body === "string" ? req.body : "";
    const token = decodeURIComponent((raw.match(/(?:^|&)token=([^&]*)/)?.[1] ?? "").replace(/\+/g, " "));
    const a = token ? await auth({ headers: { authorization: `Bearer ${token}` } }) : await auth(req as never);
    return performDeletion(a, reply, true);
  });

  app.post("/v1/account/deletion", async (req, reply) => {
    const a = await auth(req as never);
    return performDeletion(a, reply, false);
  });

  app.post("/v1/billing/webhooks", async (req, reply) => {
    const sig = String(req.headers["x-webhook-signature"] ?? "");
    const eventId = String((req.body as { eventId?: string } | undefined)?.eventId ?? "");
    if (!sig) {
      await pool.query(`INSERT INTO billing_webhook_receipts (provider_event_id, accepted, reason) VALUES ($1,false,'unsigned')`, [
        eventId || null,
      ]);
      return reply.code(401).send(err("permission_denied", "Unsigned purchase webhooks are rejected.", crypto.randomUUID()));
    }
    await pool.query(`INSERT INTO billing_webhook_receipts (provider_event_id, accepted, reason) VALUES ($1,false,'unsigned_or_unconfigured')`, [
      eventId || null,
    ]);
    return reply.code(401).send(err("permission_denied", "Purchase verification is gated until sandbox credentials exist.", crypto.randomUUID()));
  });

  app.post("/v1/purchases/restore", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const count = await pool.query(`SELECT count(*)::int AS n FROM entitlements WHERE account_id = $1`, [a.accountId]);
    return reply.code(403).send({
      code: "permission_denied",
      message: "Restore is unavailable until a store sandbox is connected. No entitlement was granted.",
      entitlements: count.rows[0]?.n ?? 0,
      available: false,
    });
  });

  app.post("/v1/purchases/verify", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    await pool.query(`INSERT INTO billing_webhook_receipts (provider_event_id, accepted, reason) VALUES ($1,false,'client_payload_untrusted')`, [
      String((req.body as { receipt?: string } | undefined)?.receipt ?? "client"),
    ]);
    const count = await pool.query(`SELECT count(*)::int AS n FROM entitlements WHERE account_id = $1`, [a.accountId]);
    return reply.code(403).send({
      code: "permission_denied",
      message: "Store purchases are gated until sandbox credentials exist. A modified client payload cannot grant entitlement.",
      entitlements: count.rows[0]?.n ?? 0,
    });
  });

  app.get("/v1/settings", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const consent = await currentConsent(pool, a.accountId);
    const allow = await pool.query(`SELECT * FROM allowance_accounts WHERE account_id = $1`, [a.accountId]);
    return {
      consent,
      processors: PROCESSOR_DISCLOSURE,
      privacyDisclosure: {
        policyVersion: CONSENT_POLICY_VERSION,
        processors: PROCESSOR_DISCLOSURE,
        dataFlows: PRIVACY_DATA_FLOWS,
        deletionVsSubscription: DELETION_VS_SUBSCRIPTION,
      },
      outputReporting: { available: true, categories: [...OUTPUT_REPORT_CATEGORIES] },
      allowance: allow.rows[0] ?? null,
      liveRouteEnabled: config.liveRouteEnabled,
      appendDocumentsAllowed: typedCorrectionsEnabled,
      fixtureRouteAllowed: config.fixtureRouteAllowed,
      capabilities: pinRouteCapabilities(config),
      purchases: { available: false, reason: "Store purchases are gated until sandbox credentials exist." },
      restore: { available: false, reason: "Restore is unavailable until a store sandbox is connected." },
      push: { available: false, reason: "Live push is gated; reopen the app to refresh research." },
    };
  });

  app.get("/v1/routes/capabilities", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { capabilities: pinRouteCapabilities(config), paidProbe: false };
  });

  app.get("/v1/runs/:id/cost", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const cost = await measureRunCost(pool, id, a.accountId);
    if (!cost) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    return cost;
  });

  // Test-only publish helper is not exposed. Tests import publishReport.
  void publishReport;
  return app;
}
