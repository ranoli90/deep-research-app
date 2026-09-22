import { RequestedVerificationRequestSchema } from "@deep/contracts";
import { admitRequestedVerification } from "../modules/requested-verification.js";
import { admitResearchCorrection,resolveResearchCorrection } from "../modules/research-corrections.js";
import { deleteSourceForAccount } from "../modules/source-deletion.js";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import {
  AssumptionsRequestSchema,
  CONSENT_POLICY_VERSION,
  ContinueRunRequestSchema,
  CorrectionRequestSchema,
  CreateRunRequestSchema,
  DEFAULT_RUN_BUDGET_MICRO,
  DELETION_VS_SUBSCRIPTION,
  FollowUpMessageRequestSchema,
  clarificationAnswersFromContinue,
  declaredClarificationFields,
  deepenFocus,
  applyInvestigationOutcome,
  pendingClarificationField,
  MAX_ATTACHMENT_BYTES,
  OUTPUT_REPORT_CATEGORIES,
  PRIVACY_DATA_FLOWS,
  PROCESSOR_DISCLOSURE,
  GuestBootstrapRequestSchema,
  GuestPendingActionRequestSchema,
  GuestClaimRequestSchema,
  GuestClaimResolveRequestSchema,
  GuestActionResumeRequestSchema,
  GuestActionResolveRequestSchema,
  GuestAuthAttemptBeginRequestSchema,
  GuestAuthAttemptEndRequestSchema,
  GuestAuthAttemptResolveRequestSchema,
  GuestPendingActionCancelRequestSchema,
  GuestClaimedActionAbandonRequestSchema,
  GuestMemberActionRegisterRequestSchema,
} from "@deep/contracts";
import {
  applyCorrectionToConstraints,
  constraintFromClarificationAnswer,
  impactForCorrection,
  inferOutputPreference,
  parseCorrection,
  routeFollowUp,
  explainFromExistingEvidence,
  shouldFullRerun,
  encodeSourcePolicy,
  mergeSteeringIntoPolicy,
  policyFromRestrictions,
} from "@deep/research-core";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { createHash } from "node:crypto";
import type { AppConfig } from "../platform/config.js";
import { assertSchemaCurrent, withTx } from "../platform/db.js";
import { exportReportForAccount } from "../modules/report-export.js";
import { errorCategory, logError } from "../platform/log.js";
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
import { toSanitizedRunEvent } from "../modules/public-activity.js";
import { measureRunCost } from "../modules/run-cost.js";
import {
  cancelOwnedRun,
  commitBriefRevision,
  emitEvent,
  findRunByIdempotency,
  getBrief,
  getRun,
  insertBrief,
  insertChildBriefRevision,
  insertConversation,
  insertRun,
  listEvents,
  listLibrary,
} from "../modules/runs.js";
import { getPassageForAccount } from "../modules/evidence.js";
import { admitClaimedReportCorrection, insertClaimedReportChallenge,
  resolveClaimedReportCorrection } from "../modules/claimed-report-actions.js";
import { excerptFromReport, getLatestReportForRun, getReportForAccount, insertChallenge, loadOwnedExplanationEvidence, publishReport, reportOwnsClaim } from "../modules/reports.js";
import { tryDispatchRun } from "../modules/run-dispatch.js";
import { admitRun } from "../modules/run-admission.js";
import { approveQueryAuthorization, pendingQueryAuthorization } from "../modules/retrieval-intelligence.js";
import { modelPolicy } from "../ports/model-policy.js";
import { admittedRunOptions, assertRouteAdmission } from "../modules/run-route-admission.js";
import { z } from "zod";
import { resolveAdmission, VerificationRecoverySchema } from "../modules/admission-recovery.js";
import { attachmentUploadReceipt, AttachmentUploadConflict, storeAttachment, validateAttachmentBytes } from "../modules/attachments.js";
import { drainFileDeletions } from "../modules/file-deletion.js";
import { verifySupabaseIdentity } from "../adapters/auth/supabase.js";
import { verifyClerkIdentity } from "../adapters/auth/clerk.js";
import { verifyClerkWebhook } from "../adapters/auth/clerk-webhook.js";
import { RESEARCH_QUEUE } from "../adapters/queue.js";
import { accountForIdentity, grantNewMemberEntitlement } from "../modules/identity.js";
import { applyClerkWebhookEvent } from "../modules/clerk-revocation.js";
import { abandonClaimedGuestAction, admitGuestFirst, beginGuestAuthAttempt, bootstrapGuest,
  cancelGuestConversationRun,
  cancelGuestPendingAction, claimGuestAction, claimedConversationScope,
  registerMemberClarificationReplacement,
  endGuestAuthAttempt, guestCanAccessRun, guestFromProof, listClaimedGuestParents,
  registerGuestPendingAction, resolveGuestAuthAttempt,
  revokeGuestConsent,
  resolveGuestAction, resolveGuestClaim, resolveGuestFirstRequest, resumeClaimedGuestAction } from "../modules/guest-auth.js";

export type AppDeps = {
  pool: pg.Pool;
  config: AppConfig;
  boss: PgBoss;
};

function err(code: string, message: string, correlationId: string, preserved = "No additional changes.") {
  return { code, message, retryable: false, correlationId, preserved };
}

/**
 * W05 canonical public route-admission tuple (F02/F03/W05 lane preserves 5 allowlisted messages).
 *
 * Only two public codes exist here; statuses are fixed (permission_denied→403,
 * allowance_exhausted→402). Any other code — including prototype-polluting keys
 * such as "__proto__"/"constructor" — maps to internal_failure/500 with a
 * generic message. Unknown messages for known codes also fall back to a generic
 * message so private error.message text never leaks. No reservation or dispatch
 * happens on any denial because callers return before admission.
 */
const ROUTE_ADMISSION_ALLOWLIST = new Map<string, readonly string[]>([
  ["permission_denied", [
    "Fixture route is disabled.",
    "Live route is not enabled.",
    "Structured research is disabled.",
    "Live route requires an authorized key and budget.",
  ]],
  ["allowance_exhausted", ["Live spend cap is exhausted."]],
]);

export function publicRouteAdmissionDenial(error: unknown): { code: string; status: number; message: string } {
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (code === "permission_denied" && typeof message === "string") {
    const allowed = ROUTE_ADMISSION_ALLOWLIST.get("permission_denied")!;
    return { code, status: 403, message: allowed.includes(message) ? message : "The request was not accepted." };
  }
  if (code === "allowance_exhausted" && typeof message === "string") {
    const allowed = ROUTE_ADMISSION_ALLOWLIST.get("allowance_exhausted")!;
    return { code, status: 402, message: allowed.includes(message) ? message : "The request was not accepted." };
  }
  return { code: "internal_failure", status: 500, message: "The request could not be completed." };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES }, (_req, body, done) => done(null, body));
  const { pool, config, boss } = deps;
  app.setErrorHandler((error, _req, reply) => {
    const {code, statusCode} = error as {code?:string; statusCode?:number};
    const status = code === "allowance_exhausted" ? 402 : statusCode && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
    const publicCode = status === 409 ? "stale_revision" : status === 400 ? "invalid_input" : status === 402 ? "allowance_exhausted" : status === 401 || status === 403 || status === 404 ? "permission_denied" : "internal_failure";
    return reply.code(status).send(err(publicCode, status === 409 ? "The request no longer matches the current research state." : status === 500 ? "The request could not be completed." : "The request was not accepted.",crypto.randomUUID()));
  });
  const typedCorrectionsEnabled=Boolean(config.structuredModelEnabled&&config.liveRouteEnabled&&config.openRouterApiKey&&config.liveSpendCapMicro>0&&(config.liveKeySpendCapMicro??0)>0);
  function guestError(reply: FastifyReply, error: unknown) {
    const code = (error as { code?: string }).code;
    const status = (error as { statusCode?: number }).statusCode;
    if (code === "allowance_exhausted") return reply.code(402).send(err("allowance_exhausted",
      "This action is saved, but available member allowance is required before it can continue.", crypto.randomUUID(),
      "The pending action remains available for an exact retry after funding."));
    if (code && status && status >= 400 && status < 500)
      return reply.code(status).send(err(code, "This guest action cannot continue with the current authority or state.", crypto.randomUUID()));
    throw error;
  }

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, String(body));
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_req, reply) => {
    try {
      await assertSchemaCurrent(pool);
      if (!await boss.getQueue(RESEARCH_QUEUE)) throw new Error("research_queue_missing");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
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
    if (config.authMode === "development") { const account = await accountFromBearer(pool, header); return account?.deleted ? null : account; }
    if (!header.startsWith("Bearer ")) return null;
    const identity = config.identityProvider === "clerk" && config.clerkAuth
      ? await verifyClerkIdentity(header.slice(7).trim(), config.clerkAuth)
      : config.supabaseAuth ? await verifySupabaseIdentity(header.slice(7).trim(), config.supabaseAuth) : null;
    if (!identity) return null;
    if (identity.status === "unavailable") throw Object.assign(new Error("Sign-in verification is temporarily unavailable."), { statusCode: 503 });
    if (identity.status !== "verified") return null;
    if (config.identityProvider === "clerk") {
      if (!("sessionId" in identity.identity)) return null;
      const revoked = await pool.query("SELECT 1 FROM clerk_revoked_sessions WHERE session_id=$1", [identity.identity.sessionId]);
      if (revoked.rowCount) return null;
    }
    const account = await accountForIdentity(pool, identity.identity);
    return account?.deleted ? null : account;
  }
  async function guest(req: { headers: Record<string, unknown> }) {
    return guestFromProof(pool, config, req.headers["x-norrow-guest-proof"]);
  }
  async function scopedReadOwner(runId: string, actor: { accountId: string },
    guestContext: Awaited<ReturnType<typeof guest>>) {
    if (guestContext) return await guestCanAccessRun(pool, guestContext, runId) ? guestContext.accountId : null;
    const own = await pool.query("SELECT 1 FROM runs WHERE id=$1 AND account_id=$2", [runId, actor.accountId]);
    if (own.rowCount) return actor.accountId;
    return (await claimedConversationScope(pool, actor.accountId, runId))?.parentExecutionOwnerId ?? null;
  }

  // A single strict transport boundary covers the formerly cast-only endpoints.
  const boundedText = z.string().trim().min(1).max(4000);
  const revision = z.number().int().positive();
  const bodySchemas: Record<string, z.ZodTypeAny> = {
    "/v1/dev/session": z.object({ email: z.string().email().max(254).optional() }).strict(),
    "/v1/guest/bootstrap": GuestBootstrapRequestSchema,
    "/v1/guest/pending-actions": GuestPendingActionRequestSchema,
    "/v1/guest/pending-actions/attempts/begin": GuestAuthAttemptBeginRequestSchema,
    "/v1/guest/pending-actions/attempts/end": GuestAuthAttemptEndRequestSchema,
    "/v1/guest/pending-actions/attempts/resolve": GuestAuthAttemptResolveRequestSchema,
    "/v1/guest/pending-actions/cancel": GuestPendingActionCancelRequestSchema,
    "/v1/guest/actions/abandon": GuestClaimedActionAbandonRequestSchema,
    "/v1/guest/actions/register-member": GuestMemberActionRegisterRequestSchema,
    "/v1/guest/claim": GuestClaimRequestSchema,
    "/v1/guest/claims/resolve": GuestClaimResolveRequestSchema,
    "/v1/guest/actions/resume": GuestActionResumeRequestSchema,
    "/v1/guest/actions/resolve": GuestActionResolveRequestSchema,
    "/v1/consent": z.object({ grant: z.boolean() }).strict(),
    "/v1/consent/member": z.object({ grant: z.boolean() }).strict(),
    "/v1/entitlements/new-member-grant": z.object({
      grantRequestId: z.string().uuid(),
      amountMicro: z.number().int().positive().max(1_000_000),
    }).strict(),
    "/v1/runs/:id/cancel": z.object({}).strict(),
    "/v1/account/deletion": z.object({}).strict(),
    "/v1/purchases/restore": z.object({}).strict(),
    "/v1/purchases/verify": z.object({receipt: z.string().max(10000).optional()}).strict(),
    "/v1/billing/webhooks": z.object({eventId: z.string().max(300).optional(), product: z.string().max(100).optional()}).strict(),
    "/v1/runs/:id/continue": z.union([ContinueRunRequestSchema, GuestActionResumeRequestSchema]),
    "/v1/runs/:id/assumptions": AssumptionsRequestSchema,
    "/v1/runs/:id/query-authorizations/approve": z.object({ authorizationId: z.string().uuid(), queryDigest: z.string().regex(/^[a-f0-9]{64}$/), terms: z.array(z.string().min(1).max(1000)).max(200) }).strict(),
    "/v1/runs/:id/follow-up": z.union([GuestActionResumeRequestSchema, RequestedVerificationRequestSchema,
      FollowUpMessageRequestSchema,
      z.object({ claimId: z.string().uuid().optional(), note: boundedText.optional() }).strict()]),
    "/v1/reports/:id/challenges": z.object({ claimId: z.string().uuid().optional(), category: z.enum([...OUTPUT_REPORT_CATEGORIES,"claim"]).optional(), note: boundedText.optional(), includeExcerpt: z.boolean().optional(), excerptText: z.string().max(4000).optional() }).strict(),
  };
  app.addHook("preValidation", async (req, reply) => {
    const route = req.routeOptions.url ?? "";
    const proof = req.headers["x-norrow-guest-proof"];
    if (proof !== undefined) {
      const guestRoutes = new Set(["/v1/session", "/v1/consent", "/v1/consent/member", "/v1/runs", "/v1/run-requests/resolve",
        "/v1/guest/pending-actions", "/v1/guest/pending-actions/attempts/begin",
        "/v1/guest/pending-actions/attempts/end", "/v1/guest/pending-actions/attempts/resolve",
        "/v1/guest/pending-actions/cancel",
        "/v1/guest/claim", "/v1/runs/:id", "/v1/runs/:id/events",
        "/v1/runs/:id/cancel", "/v1/runs/:id/cost", "/v1/reports/:id", "/v1/sources/:id",
        "/v1/settings", "/v1/routes/capabilities", "/v1/guest"]);
      if (!guestRoutes.has(route) || (req.headers.authorization && route !== "/v1/guest/claim" && route !== "/v1/consent/member"))
        return reply.code(403).send(err("authority_denied", "This credential combination is not allowed.", crypto.randomUUID()));
    }
    if (route.includes(":id") && !z.object({ id: z.string().uuid() }).strict().safeParse(req.params).success)
      return reply.code(400).send(err("invalid_input", "A valid object identity is required.", crypto.randomUUID()));
    if (req.method === "GET" && route.startsWith("/v1/")) {
      const query = route.endsWith("/events") ? z.object({ after: z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine((v) => Number.isSafeInteger(Number(v))).optional() }).strict() : z.object({}).strict();
      if (!query.safeParse(req.query).success) return reply.code(400).send(err("invalid_input", "Invalid query or event cursor.", crypto.randomUUID()));
    }
    const schema = bodySchemas[route];
    if (schema) {
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(err("invalid_input", "Invalid request fields.", crypto.randomUUID()));
      req.body = parsed.data;
    }
  });

  app.post("/v1/guest/bootstrap", async (req, reply) => {
    try {
      const result = await bootstrapGuest(pool, config, req.ip);
      return reply.code(201).send(result);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      if (code && status !== 500) return reply.code(status).send(err(code, "Guest research is not currently available.", crypto.randomUUID()));
      throw error;
    }
  });

  app.post("/v1/guest/pending-actions", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    const parsed = GuestPendingActionRequestSchema.parse(req.body);
    try {
      return reply.code(202).send(await registerGuestPendingAction(pool, context, parsed));
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      if (code && status !== 500) return reply.code(status).send(err(code, "The pending action cannot be saved.", crypto.randomUUID()));
      throw error;
    }
  });

  app.post("/v1/guest/pending-actions/attempts/begin", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    try { return await beginGuestAuthAttempt(pool, context, GuestAuthAttemptBeginRequestSchema.parse(req.body)); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/pending-actions/attempts/end", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    try { return await endGuestAuthAttempt(pool, context, GuestAuthAttemptEndRequestSchema.parse(req.body)); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/pending-actions/attempts/resolve", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    try { return await resolveGuestAuthAttempt(pool, context, GuestAuthAttemptResolveRequestSchema.parse(req.body)); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/pending-actions/cancel", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    try { return await cancelGuestPendingAction(pool, context,
      GuestPendingActionCancelRequestSchema.parse(req.body).submissionId); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/actions/abandon", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("authority_denied", "Sign in required.", crypto.randomUUID()));
    const input = GuestClaimedActionAbandonRequestSchema.parse(req.body);
    try { return await abandonClaimedGuestAction(pool, member.accountId, input.claimRequestId, input.submissionId); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/actions/register-member", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("authority_denied", "Sign in required.", crypto.randomUUID()));
    try { return await registerMemberClarificationReplacement(pool, member.accountId,
      GuestMemberActionRegisterRequestSchema.parse(req.body)); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/claim", async (req, reply) => {
    const context = await guest(req as never);
    const member = await auth(req as never);
    if (!context || !member || member.deleted) return reply.code(403).send(err("authority_denied", "Both verified member and guest proof are required.", crypto.randomUUID()));
    try {
      return await claimGuestAction(pool, context, member.accountId, member.deletionEpoch,
        GuestClaimRequestSchema.parse(req.body));
    } catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/claims/resolve", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("authority_denied", "Sign in required.", crypto.randomUUID()));
    const input = GuestClaimResolveRequestSchema.parse(req.body);
    try { return await resolveGuestClaim(pool, member.accountId, input.claimRequestId, input.submissionId); }
    catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/actions/resume", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("authority_denied", "Sign in required.", crypto.randomUUID()));
    try {
      const result = await resumeClaimedGuestAction(pool, member.accountId,
        GuestActionResumeRequestSchema.parse(req.body), config);
      if (!result.reused) await tryDispatchRun(pool, boss, result.runId);
      return result;
    } catch (error) { return guestError(reply, error); }
  });

  app.post("/v1/guest/actions/resolve", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("authority_denied", "Sign in required.", crypto.randomUUID()));
    const input = GuestActionResolveRequestSchema.parse(req.body);
    try { return await resolveGuestAction(pool, member.accountId, input.claimRequestId, input.submissionId, config); }
    catch (error) { return guestError(reply, error); }
  });

  app.get("/v1/session", async (req, reply) => {
    const g = await guest(req as never);
    if (g) {
      const consent = await currentConsent(pool, g.accountId);
      return { actorKind: "guest", guestContextId: g.id, conversationId: g.conversationId,
        conversationVersion: 1, controlVersion: g.controlVersion, acceptedTurnCount: g.acceptedTurnCount,
        expiresAt: g.expiresAt.toISOString(), consentGranted: Boolean(consent && !consent.revoked),
        firstTurnAvailable: g.acceptedTurnCount === 0 };
    }
    const account = await auth(req as never);
    if (!account || account.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { accountId: account.accountId, authMode: config.authMode, actorKind: "member",
      deletionEpoch: account.deletionEpoch };
  });

  app.get("/v1/auth/capabilities", async () => ({ apple: Boolean(config.providerCapabilities.apple),
    google: Boolean(config.providerCapabilities.google), emailCode: Boolean(config.providerCapabilities.emailCode),
    termsUrl: config.providerCapabilities.termsUrl ?? null,
    privacyUrl: config.providerCapabilities.privacyUrl ?? null }));

  app.post("/v1/consent", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { grant?: boolean };
    if (typeof body.grant !== "boolean") {
      return reply.code(400).send(err("invalid_input", "An explicit consent choice is required.", crypto.randomUUID()));
    }
    if (body.grant === false) {
      if (g) {
        const revoked = await revokeGuestConsent(pool, g);
        return { granted: false, consentEpoch: revoked.epoch, controlVersion: revoked.controlVersion,
          processors: PROCESSOR_DISCLOSURE };
      }
      const epoch = await revokeConsent(pool, a.accountId);
      return { granted: false, consentEpoch: epoch, processors: PROCESSOR_DISCLOSURE };
    }
    const r = await grantConsent(pool, a.accountId);
    return { granted: true, consentEpoch: r.epoch, policyVersion: CONSENT_POLICY_VERSION, processors: r.processors };
  });

  /**
   * F03 explicit member-consent route (mobile contract).
   *
   * POST /v1/consent/member { grant: true|false }
   * Auth: member Bearer only (dev session or Clerk/verified member). Any
   * x-norrow-guest-proof header is ignored, never used to resolve consent.
   * 200 { granted, consentEpoch, policyVersion?, processors } on grant;
   * 200 { granted:false, consentEpoch, processors } on revoke.
   * 401 when member auth absent/deleted; 400 when grant is not boolean.
   * resumeClaimedGuestAction still fails closed 403 consent_required until this
   * route has granted the current CONSENT_POLICY_VERSION for the member.
   */
  app.post("/v1/consent/member", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { grant?: boolean };
    if (typeof body.grant !== "boolean") {
      return reply.code(400).send(err("invalid_input", "An explicit consent choice is required.", crypto.randomUUID()));
    }
    if (body.grant === false) {
      const epoch = await revokeConsent(pool, member.accountId);
      return { granted: false, consentEpoch: epoch, processors: PROCESSOR_DISCLOSURE };
    }
    const granted = await grantConsent(pool, member.accountId);
    return { granted: true, consentEpoch: granted.epoch,
      policyVersion: CONSENT_POLICY_VERSION, processors: granted.processors };
  });

  /**
   * F02 server-owned bounded new-member trial (mobile/operator contract).
   *
   * POST /v1/entitlements/new-member-grant { grantRequestId: uuid, amountMicro: 1..1000000 }
   * Auth: member Bearer only; guest proof alone is 401/403 and never grants.
   * The body stays backward compatible, but `amountMicro` is only an idempotency
   * request fingerprint: the SERVER policy row selects the credited amount,
   * eligibility, expiry and funded sponsor exposure cap. Arbitrary caller amounts
   * never determine credit.
   * 200 { grantRequestId, accountId, amountMicro, limitMicro, reused }.
   * Same id+request replays with reused:true and no double spend; same id with a
   * different request is 409; same id on a different account is 403 with no grant;
   * an unexpired, enabled, unfunded first claim is required; a repeat trial or a
   * reached global exposure cap is 403/402 with no grant. Zero default preserved.
   */
  app.post("/v1/entitlements/new-member-grant", async (req, reply) => {
    const member = await auth(req as never);
    if (!member || member.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const body = (req.body ?? {}) as { grantRequestId?: unknown; amountMicro?: unknown };
    if (typeof body.grantRequestId !== "string" || typeof body.amountMicro !== "number") {
      return reply.code(400).send(err("invalid_input", "An explicit grant identity and bounded amount are required.", crypto.randomUUID()));
    }
    try {
      return await grantNewMemberEntitlement(pool, member.accountId, body.grantRequestId, body.amountMicro);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status = (error as { statusCode?: number }).statusCode;
      if (code === "invalid_input") return reply.code(400).send(err(code, "An explicit grant identity and bounded amount are required.", crypto.randomUUID()));
      if (code === "authority_denied") return reply.code(403).send(err(code, "This grant is not authorized for this account.", crypto.randomUUID()));
      if (code === "idempotency_conflict") return reply.code(409).send(err("stale_revision", "This grant identity was already used with different terms.", crypto.randomUUID()));
      if (code === "permission_denied") return reply.code(403).send(err(code, "This grant is not available for this account.", crypto.randomUUID()));
      if (code === "allowance_exhausted") return reply.code(402).send(err(code, "Not enough remaining allowance.", crypto.randomUUID()));
      if (code && status && status >= 400 && status < 500)
        return reply.code(status).send(err(code, "This grant cannot be accepted.", crypto.randomUUID()));
      throw error;
    }
  });

  app.post("/v1/run-requests/resolve", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const input = z.object({ idempotencyKey: z.string().uuid(), verification: VerificationRecoverySchema.optional() }).strict().safeParse(req.body);
    if (!input.success) return reply.code(400).send(err("invalid_input", "Saved request key required.", crypto.randomUUID()));
    if (g && input.data.verification) return reply.code(403).send(err("authority_denied", "Guest proof is limited to the first request.", crypto.randomUUID()));
    const resolved = g ? await resolveGuestFirstRequest(pool, g, input.data.idempotencyKey)
      : await resolveAdmission(pool, a.accountId, input.data.idempotencyKey, input.data.verification);
    if (!resolved) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return resolved;
  });

  app.post("/v1/runs", async (req, reply) => {
    const correlationId = crypto.randomUUID();
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", correlationId));
    const parsed = CreateRunRequestSchema.strict().safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(err("invalid_input", parsed.error.issues[0]?.message ?? "invalid", correlationId));
    }
    const input = parsed.data;
    const suppliedKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).safeParse(req.headers["idempotency-key"]);
    if ((input.routeMode === "controlled-research" || req.headers["idempotency-key"] !== undefined) && !suppliedKey.success)
      return reply.code(400).send(err("invalid_input", "An explicit idempotency key is required.", correlationId));
    try { await assertRouteAdmission(pool, config, input.routeMode); }
    catch (error) {
      // Canonical public tuple: no reservation/dispatch happens on denial and
      // no arbitrary error.message/code leaks. Unknown errors map to 500.
      const pub = publicRouteAdmissionDenial(error);
      if (pub.status === 500) logError("route_admission_unexpected", { correlationId });
      return reply.code(pub.status).send(err(pub.code, pub.message, correlationId));
    }
    const consent = await currentConsent(pool, a.accountId);
    if (!consent || consent.revoked) {
      return reply.code(403).send(err("consent_required", "Grant AI processing consent before starting research.", correlationId, "Draft is preserved on device."));
    }
    const idempotencyKey = suppliedKey.success ? suppliedKey.data : crypto.randomUUID();
    try {
      const created = g ? await admitGuestFirst(pool, config, g, idempotencyKey, input) : await admitRun(pool, a.accountId, idempotencyKey, input,
        admittedRunOptions(config));
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
      if (code === "idempotency_conflict" || code === "stale_revision" || code === "idempotency_withdrawn" || code === "intent_stale") {
        return reply.code(409).send(err(code, "Request conflicts with the accepted revision or idempotency key.", correlationId));
      }
      if (code === "permission_denied" || code === "consent_required" || code === "AUTH_REQUIRED_NEXT_TURN" || code === "authority_denied" || code === "guest_expired" || code === "guest_deleted") {
        return reply.code(403).send(err(code, "Run inputs are not authorized for this account and consent.", correlationId));
      }
      if (code === "allowance_exhausted" || code === "attempt_budget_exhausted") {
        return reply.code(402).send(err("allowance_exhausted", "Not enough remaining allowance.", correlationId));
      }
      if (code === "no_admitted_route" || code === "zdr_incompatible_unavailable" || code === "structured_output_required" || code === "candidate_unavailable" || code === "privacy_incompatible_unavailable" || code === "model_policy_mismatch") {
        return reply.code(403).send(err(code, "No privacy-admitted model route is available for this run.", correlationId));
      }
      logError("create_run_failed", { correlationId, error: errorCategory(e) });
      return reply.code(500).send(err("internal_failure", "Could not accept the run.", correlationId));
    }
  });

  app.get("/v1/runs/:id", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const owner = await scopedReadOwner(id, a, g);
    if (!owner) return reply.code(404).send(err("authority_denied", "Run not found.", crypto.randomUUID()));
    const run = await getRun(pool, id);
    if (!run || run.account_id !== owner) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const brief = await getBrief(pool, run.brief_id);
    const report = await getLatestReportForRun(pool, run.id, owner);
    const contentInvalidated = Boolean((await pool.query(
      "SELECT 1 FROM tombstones WHERE account_id=$1 AND object_kind='run' AND object_id=$2 AND reason='source_deletion' LIMIT 1",
      [owner, run.id],
    )).rowCount);
    const pendingQuery = await pendingQueryAuthorization(pool, { accountId: owner, runId: run.id, briefRevision: run.brief_revision });
    const pendingField = pendingClarificationField(run.pending_input_field);
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
      pendingQueryAuthorization: run.lifecycle === "awaiting_input" ? pendingQuery : null,
      pendingInput: run.lifecycle === "awaiting_input" && run.pending_input_id ? { id: run.pending_input_id, type: run.pending_input_type, briefRevision: run.pending_input_revision, ...(pendingField ? { field: pendingField } : {}) } : null,
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
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const owner = await scopedReadOwner(id, a, g);
    if (!owner) return reply.code(404).send(err("authority_denied", "Run not found.", crypto.randomUUID()));
    const run = await getRun(pool, id);
    if (!run || run.account_id !== owner) {
      return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    }
    const after = Number((req.query as { after?: string }).after ?? 0);
    const events = await listEvents(pool, id, after);
    return {
      events: events.map((e) =>
        toSanitizedRunEvent({
          id: e.id,
          runId: id,
          sequence: Number(e.sequence),
          type: e.type,
          public_summary: e.public_summary,
          phase: e.phase,
          created_at: e.created_at,
          payload: e.payload,
        }),
      ),
    };
  });

  app.post("/v1/runs/:id/cancel", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const owner = await scopedReadOwner(id, a, g);
    if (!owner) return reply.code(404).send(err("authority_denied", "Run not found.", crypto.randomUUID()));
    let updated;
    try { updated = g ? await cancelGuestConversationRun(pool, id, { kind: "guest", context: g })
      : owner !== a.accountId ? await cancelGuestConversationRun(pool, id,
        { kind: "claimed", memberAccountId: a.accountId }) : await cancelOwnedRun(pool, owner, id); }
    catch (error) { return guestError(reply, error); }
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
      if (!run || !await claimedConversationScope(pool, a.accountId, id))
        return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      const saved = GuestActionResumeRequestSchema.safeParse(req.body);
      if (!saved.success) return reply.code(409).send(err("intent_stale",
        "An exact saved clarification action is required.", crypto.randomUUID()));
      try {
        const result = await resumeClaimedGuestAction(pool, a.accountId,
          { ...saved.data, expectedParentRunId: id, expectedKind: "clarification" }, config);
        if (!result.reused) await tryDispatchRun(pool, boss, result.runId);
        return result;
      } catch (error) { return guestError(reply, error); }
    }
    if (run.lifecycle !== "awaiting_input") {
      return reply.code(409).send(err("stale_revision", "This run is not waiting for input.", crypto.randomUUID()));
    }
    const parsedBody = ContinueRunRequestSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(err("invalid_input", "A material clarification answer is required to continue.", crypto.randomUUID()));
    }
    const body = parsedBody.data;
    try {
      await withTx(pool, async (db) => {
        await lockActiveAccount(db, a.accountId);
        const current = await getRun(db, id, { forUpdate: true });
        if (!current || current.account_id !== a.accountId) {
          throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
        }
        if (current.lifecycle !== "awaiting_input" || current.pending_input_type !== "clarification" || current.pending_input_id !== body.pendingInputId || current.brief_revision !== body.expectedBriefRevision) {
          throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
        }
        const declared = declaredClarificationFields(current.pending_input_field);
        if (!declared.length) {
          throw Object.assign(new Error("stale_revision"), { statusCode: 409, code: "stale_revision", message: "Refresh this clarification. The pending field must be reissued." });
        }
        const accepted = clarificationAnswersFromContinue(body, declared);
        if (!accepted.ok) {
          const message = accepted.reason === "extra_field"
            ? "Answer only the pending clarification field."
            : accepted.reason === "conflicting_values"
              ? "Conflicting answers for the pending field are not accepted."
              : "A material clarification answer is required to continue.";
          throw Object.assign(new Error("invalid_input"), { statusCode: 400, message });
        }
        const parsedAnswers = accepted.answers.map((row) => constraintFromClarificationAnswer(row.field, row.value));
        if (parsedAnswers.some((row) => !row.ok)) {
          throw Object.assign(new Error("invalid_input"), { statusCode: 400 });
        }
        const resumed = await db.query(
          `UPDATE runs SET lifecycle='queued', phase='preparing', updated_at=now()
           WHERE id=$1 AND account_id=$2 AND lifecycle='awaiting_input'
             AND pending_input_id=$3 AND pending_input_type='clarification'
             AND brief_revision=$4 AND cancellation_epoch=$5
           RETURNING id`,
          [id, a.accountId, current.pending_input_id, current.brief_revision, current.cancellation_epoch],
        );
        if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
        const brief = await getBrief(db, current.brief_id);
        const originalQuestion = brief.originalQuestion;
        let constraints = [...brief.constraints];
        for (const parsed of parsedAnswers) {
          if (!parsed.ok) continue;
          constraints = [...constraints.filter((c) => c.field !== parsed.constraint.field), parsed.constraint];
        }
        await commitBriefRevision(db, {
          accountId: a.accountId,
          runId: id,
          expectedRevision: current.brief_revision,
          originalQuestion,
          next: { ...brief, originalQuestion, constraints },
        });
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
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 500;
      if (status === 401) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
      if (status === 404) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      if (status === 409) return reply.code(409).send(err("stale_revision", (e as Error).message === "Refresh this clarification. The pending field must be reissued." ? (e as Error).message : "This answer does not match the pending clarification.", crypto.randomUUID()));
      if (status === 400) return reply.code(400).send(err("invalid_input", (e as Error).message && (e as Error).message !== "invalid_input" ? (e as Error).message : "A material clarification answer is required to continue.", crypto.randomUUID()));
      throw e;
    }
    const latest = await getRun(pool, id);
    if (latest?.lifecycle === "queued") await tryDispatchRun(pool, boss, id);
    return { runId: id, lifecycle: latest?.lifecycle ?? "queued" };
  });

  app.post("/v1/runs/:id/assumptions", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { action: "confirm" | "replace"; values?: string[]; expectedBriefRevision?: number };
    const action = body.action === "replace" ? "replace" : "confirm";
    const values = Array.isArray(body.values) ? body.values.map((v) => String(v).trim()).filter(Boolean).slice(0, 12) : [];
    if (action === "replace" && !values.length) {
      return reply.code(400).send(err("invalid_input", "Replacement assumptions cannot be empty.", crypto.randomUUID()));
    }
    try {
      const result = await withTx(pool, async (db) => {
        await lockActiveAccount(db, a.accountId);
        const run = await getRun(db, id, { forUpdate: true });
        if (!run || run.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
        const brief = await getBrief(db, run.brief_id);
        if (body.expectedBriefRevision !== run.brief_revision)
          throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
        if (action === "replace" && run.lifecycle === "awaiting_input")
          throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
        const current = Array.isArray(brief.assumptions) ? brief.assumptions : [];
        const nextAssumptions = action === "replace"
          ? values.map((value, index) => ({
              ...(typeof current[index] === "object" && current[index] ? current[index] : {
                id: `assumption-${index}`,
                reversibility: "reversible" as const,
                impact: "User-supplied assumption",
              }),
              value,
              userConfirmationState: "accepted" as const,
            }))
          : current.map((item) => ({ ...item, userConfirmationState: "accepted" as const }));
        if (action === "confirm") {
          await db.query(`UPDATE research_briefs SET payload = $2 WHERE id = $1 AND original_question = $3`,
            [brief.id, JSON.stringify({ ...brief, assumptions: nextAssumptions }), brief.originalQuestion]);
          await emitEvent(db, {
            runId: id, accountId: a.accountId, type: "clarification_answered",
            summary: "Assumptions confirmed.", phase: "preparing",
          });
          return { runId: id, action, briefRevision: run.brief_revision };
        }
        if (run.lifecycle === "running") {
          throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
        }
        if (run.lifecycle === "terminal") {
          return { action, ...await insertChildBriefRevision(db, {accountId:a.accountId,parent:run,expectedRevision:body.expectedBriefRevision!,next:{...brief,assumptions:nextAssumptions},
            idempotencyKey:String(req.headers["idempotency-key"] ?? "")}) };
        }
        const committed = await commitBriefRevision(db, {
          accountId: a.accountId, runId: id, expectedRevision: run.brief_revision,
          originalQuestion: brief.originalQuestion, next: { ...brief, assumptions: nextAssumptions },
        });
        if (run.lifecycle === "awaiting_input") {
          const resumed = await db.query(
            `UPDATE runs SET lifecycle='queued', phase='preparing', pending_input_id=NULL, pending_input_type=NULL, pending_input_revision=NULL, pending_input_field=NULL, updated_at=now()
             WHERE id=$1 AND lifecycle='awaiting_input' AND cancellation_epoch=$2 RETURNING id`,
            [id, run.cancellation_epoch],
          );
          if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          await db.query(`INSERT INTO run_dispatch_outbox (run_id) VALUES ($1)
            ON CONFLICT (run_id) DO UPDATE SET state = 'pending', attempt_id = NULL,
              lease_until = NULL, next_attempt_at = now()`, [id]);
        }
        await emitEvent(db, {
          runId: id, accountId: a.accountId, type: "clarification_answered",
          summary: "Assumptions updated.", phase: "preparing", payload: { briefRevision: committed.briefRevision },
        });
        return { runId: id, action, briefRevision: committed.briefRevision };
      });
      if ("parentRunId" in result) await tryDispatchRun(pool, boss, result.runId);
      else if (action === "replace") await tryDispatchRun(pool, boss, result.runId);
      return result;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      if (status === 409) return reply.code(409).send(err("stale_revision", "This run cannot replace assumptions in its current state.", crypto.randomUUID()));
      if (status === 403) return reply.code(403).send(err("consent_required", "Consent required.", crypto.randomUUID()));
      throw e;
    }
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
        if (run.lifecycle === "awaiting_input" && (run.pending_input_type !== "query_authorization" || run.pending_input_id !== authorizationId || run.pending_input_revision !== run.brief_revision))
          throw Object.assign(new Error("stale_revision"), { statusCode: 409, code: "stale_revision" });
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
          const resumed = await db.query(
            `UPDATE runs SET lifecycle='queued', phase='preparing', pending_input_id=NULL, pending_input_type=NULL, pending_input_revision=NULL, pending_input_field=NULL, updated_at=now()
             WHERE id=$1 AND lifecycle='awaiting_input' AND pending_input_type='query_authorization' AND pending_input_id=$2 AND cancellation_epoch=$3
             RETURNING id`,
            [id, authorizationId, run.cancellation_epoch],
          );
          if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409, code: "stale_revision" });
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
    const parent=await getRun(pool,id.data);
    if(parent && parent.account_id!==a.accountId){
      if(!await claimedConversationScope(pool,a.accountId,id.data))
        return reply.code(404).send(err("authority_denied","Run not found.",crypto.randomUUID()));
      try { return await resolveClaimedReportCorrection(pool,a.accountId,id.data,input.data); }
      catch(error){ return guestError(reply,error); }
    }
    const result=await resolveResearchCorrection(pool,a.accountId,id.data,input.data);
    if(!result)return reply.code(401).send(err("permission_denied","Sign in required.",crypto.randomUUID()));
    return result;
  });

  app.post("/v1/runs/:id/corrections", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const parsed = CorrectionRequestSchema.strict().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(err("invalid_input", "Invalid correction.", crypto.randomUUID()));
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      if (!run || !await claimedConversationScope(pool, a.accountId, id))
        return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      if (!parsed.data.patch || !typedCorrectionsEnabled)
        return reply.code(409).send(err("invalid_input", "Structured corrections are unavailable on this route.", crypto.randomUUID()));
      try {
        const created = await admitClaimedReportCorrection(pool, config, a.accountId, id, parsed.data);
        if (!created.reused) await tryDispatchRun(pool, boss, created.runId);
        return created;
      } catch (error) { return guestError(reply, error); }
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
        originalQuestion: parentBrief.originalQuestion,
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
    if (!a || a.deleted) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const run = await getRun(pool, id);
    if (!run || run.account_id !== a.accountId) {
      if (!run || !await claimedConversationScope(pool, a.accountId, id))
        return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
      const saved = GuestActionResumeRequestSchema.safeParse(req.body);
      if (!saved.success) return reply.code(409).send(err("intent_stale",
        "An exact saved follow-up action is required.", crypto.randomUUID()));
      try {
        const result = await resumeClaimedGuestAction(pool, a.accountId,
          { ...saved.data, expectedParentRunId: id, expectedKind: "follow_up" }, config);
        if (!result.reused) await tryDispatchRun(pool, boss, result.runId);
        return result;
      } catch (error) { return guestError(reply, error); }
    }
    const followBody = (req.body ?? {}) as { claimId?: string; note?: string; message?: string; expectedBriefRevision?: number };
    if (!followBody.claimId && followBody.message) {
      const report = await getLatestReportForRun(pool, id, a.accountId);
      const routed = routeFollowUp(followBody.message, {
        reportReady: Boolean(report),
        runActive: run.lifecycle !== "terminal",
      });
      if (routed.kind === "explain" && !routed.mutatesBrief) {
        const evidence = await loadOwnedExplanationEvidence(pool, { runId: id, accountId: a.accountId, report });
        const explained = explainFromExistingEvidence({
          message: followBody.message,
          blocks: evidence.blocks,
          claims: evidence.claims,
          passages: evidence.passages,
        });
        return {
          kind: "explain",
          runId: id,
          reason: routed.reason,
          mutatesBrief: false,
          answer: explained.answer,
          citationPassageIds: explained.citationPassageIds,
          evidenceComplete: explained.evidenceComplete,
          ...(explained.evidenceComplete ? {} : { needsTargetedResearch: true }),
        };
      }
      if ((routed.kind === "steer" || routed.kind === "add_source") && !routed.mutatesBrief) {
        const revised = await withTx(pool, async (db) => {
          await lockActiveAccount(db, a.accountId);
          const current = await getRun(db, id, { forUpdate: true });
          if (!current || current.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
          const brief = await getBrief(db, current.brief_id);
          const nextPolicy = mergeSteeringIntoPolicy(policyFromRestrictions(brief.sourceRestrictions), followBody.message!);
          const originalQuestion = brief.originalQuestion;
          if (current.lifecycle === "terminal") return insertChildBriefRevision(db,{accountId:a.accountId,parent:current,
            expectedRevision:followBody.expectedBriefRevision!,next:{...brief,sourceRestrictions:encodeSourcePolicy(nextPolicy)},idempotencyKey:String(req.headers["idempotency-key"] ?? "")});
          if (current.brief_revision !== followBody.expectedBriefRevision || !["queued","running"].includes(current.lifecycle))
            throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          const committed = await commitBriefRevision(db, { accountId: a.accountId, runId: id, expectedRevision: followBody.expectedBriefRevision!, originalQuestion,
            next: { ...brief, sourceRestrictions: encodeSourcePolicy(nextPolicy) } });
          // Expire the old worker lease. Its late receipts may settle, but it can
          // neither issue another operation nor publish on the superseded brief.
          await db.query("UPDATE run_leases SET expires_at=now() WHERE run_id=$1", [id]);
          const resumed = await db.query(
            `UPDATE runs SET lifecycle='queued', phase='preparing' WHERE id=$1 AND lifecycle IN ('queued','running') AND cancellation_epoch=$2 RETURNING id`,
            [id, current.cancellation_epoch],
          );
          if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          await db.query(`INSERT INTO run_dispatch_outbox(run_id) VALUES($1) ON CONFLICT(run_id) DO UPDATE
            SET state='pending',attempt_id=NULL,lease_until=NULL,next_attempt_at=now()`, [id]);
          await emitEvent(db, {
            runId: id,
            accountId: a.accountId,
            type: "plan_pivot",
            summary: routed.kind === "add_source" ? "A source URL was added for later research steps." : "Source preferences were updated for later research steps.",
            phase: current.phase,
            payload: { kind: routed.kind, mutatesIssuedIdentities: false, briefRevision: committed.briefRevision },
          });
          return {runId:id,briefRevision:committed.briefRevision};
        });
        await tryDispatchRun(pool, boss, revised.runId);
        return { kind: routed.kind, ...revised, reason: routed.reason, mutatesBrief: true, mutatesIssuedIdentities: false };
      }
      if (routed.kind === "deepen") {
        if (!report) return reply.code(409).send(err("stale_revision", "Deepen requires a current report.", crypto.randomUUID()));
        if (followBody.expectedBriefRevision == null) return reply.code(400).send(err("invalid_input", "expectedBriefRevision is required to deepen research.", crypto.randomUUID()));
        const deepened = await withTx(pool, async (db) => {
          await lockActiveAccount(db, a.accountId);
          const current = await getRun(db, id, { forUpdate: true });
          if (!current || current.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
          const brief = await getBrief(db, current.brief_id);
          const nextBrief = {
            ...brief,
            originalQuestion: brief.originalQuestion,
            desiredOutcome: applyInvestigationOutcome(brief.desiredOutcome, deepenFocus(followBody.message!)),
          };
          if (current.lifecycle === "terminal") {
            return insertChildBriefRevision(db, {
              accountId: a.accountId,
              parent: current,
              expectedRevision: followBody.expectedBriefRevision!,
              next: nextBrief,
              idempotencyKey: String(req.headers["idempotency-key"] ?? ""),
            });
          }
          if (current.brief_revision !== followBody.expectedBriefRevision || !["queued", "running"].includes(current.lifecycle)) {
            throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          }
          const committed = await commitBriefRevision(db, {
            accountId: a.accountId,
            runId: id,
            expectedRevision: followBody.expectedBriefRevision!,
            originalQuestion: brief.originalQuestion,
            next: nextBrief,
          });
          await db.query("UPDATE run_leases SET expires_at=now() WHERE run_id=$1", [id]);
          const resumed = await db.query(
            `UPDATE runs SET lifecycle='queued', phase='preparing' WHERE id=$1 AND lifecycle IN ('queued','running') AND cancellation_epoch=$2 RETURNING id`,
            [id, current.cancellation_epoch],
          );
          if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          await db.query(`INSERT INTO run_dispatch_outbox(run_id) VALUES($1) ON CONFLICT(run_id) DO UPDATE
            SET state='pending',attempt_id=NULL,lease_until=NULL,next_attempt_at=now()`, [id]);
          return { runId: id, briefRevision: committed.briefRevision };
        });
        await tryDispatchRun(pool, boss, deepened.runId);
        return { kind: "deepen", ...deepened, reason: routed.reason, mutatesBrief: false, mutatesIssuedIdentities: false, parentRunId: id };
      }
      if (routed.kind === "change_constraint") {
        if (followBody.expectedBriefRevision == null) return reply.code(400).send(err("invalid_input", "expectedBriefRevision is required to change a constraint.", crypto.randomUUID()));
        const parsedChange = parseCorrection(followBody.message!);
        if (parsedChange.kind !== "constraint_change" || (!parsedChange.field && !parsedChange.drop && !parsedChange.value)) {
          return reply.code(409).send(err("unsupported_follow_up", "Restate the budget, place, or requirement. The original question is unchanged.", crypto.randomUUID()));
        }
        const changed = await withTx(pool, async (db) => {
          await lockActiveAccount(db, a.accountId);
          const current = await getRun(db, id, { forUpdate: true });
          if (!current || current.account_id !== a.accountId) throw Object.assign(new Error("permission_denied"), { statusCode: 404 });
          const brief = await getBrief(db, current.brief_id);
          const applied = applyCorrectionToConstraints(brief.constraints, followBody.message!);
          const next = { ...brief, originalQuestion: brief.originalQuestion, constraints: applied.next };
          if (current.lifecycle === "terminal") {
            return insertChildBriefRevision(db, {
              accountId: a.accountId,
              parent: current,
              expectedRevision: followBody.expectedBriefRevision!,
              next,
              idempotencyKey: String(req.headers["idempotency-key"] ?? ""),
            });
          }
          if (current.brief_revision !== followBody.expectedBriefRevision || !["queued", "running"].includes(current.lifecycle)) {
            throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          }
          const committed = await commitBriefRevision(db, {
            accountId: a.accountId,
            runId: id,
            expectedRevision: followBody.expectedBriefRevision!,
            originalQuestion: brief.originalQuestion,
            next,
          });
          await db.query("UPDATE run_leases SET expires_at=now() WHERE run_id=$1", [id]);
          const resumed = await db.query(
            `UPDATE runs SET lifecycle='queued', phase='preparing' WHERE id=$1 AND lifecycle IN ('queued','running') AND cancellation_epoch=$2 RETURNING id`,
            [id, current.cancellation_epoch],
          );
          if (!resumed.rows[0]) throw Object.assign(new Error("stale_revision"), { statusCode: 409 });
          await db.query(`INSERT INTO run_dispatch_outbox(run_id) VALUES($1) ON CONFLICT(run_id) DO UPDATE
            SET state='pending',attempt_id=NULL,lease_until=NULL,next_attempt_at=now()`, [id]);
          await emitEvent(db, {
            runId: id,
            accountId: a.accountId,
            type: "plan_pivot",
            summary: "A constraint was updated without rewriting the original question.",
            phase: current.phase,
            payload: {
              kind: "change_constraint",
              field: parsedChange.field ?? null,
              value: parsedChange.value ?? null,
              units: parsedChange.units ?? null,
              operator: parsedChange.field === "budget" ? "lte" : parsedChange.field === "geography" || parsedChange.field === "platform" ? "eq" : null,
              drop: parsedChange.drop === true,
              acceptedChange: followBody.message,
              briefRevision: committed.briefRevision,
            },
          });
          return { runId: id, briefRevision: committed.briefRevision };
        });
        await tryDispatchRun(pool, boss, changed.runId);
        return { kind: "change_constraint", ...changed, reason: routed.reason, mutatesBrief: true, mutatesIssuedIdentities: false, parentRunId: id };
      }
      if (routed.kind === "new_research") {
        return reply.code(409).send(err("unsupported_follow_up", "Start a new research question from the composer. Private attachments are not inherited.", crypto.randomUUID()));
      }
      if (routed.kind === "verify_challenge") {
        return reply.code(409).send(err("unsupported_follow_up", "Select the conclusion to verify. A follow-up message is not a verification target.", crypto.randomUUID()));
      }
      const _exhaustive: typeof routed.kind = routed.kind;
      void _exhaustive;
      return reply.code(400).send(err("invalid_input", "This follow-up is not a supported research operation.", crypto.randomUUID()));
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
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const reportId = (req.params as { id: string }).id;
    const resource = (await pool.query<{ run_id: string }>("SELECT run_id FROM reports WHERE id=$1", [reportId])).rows[0];
    const owner = resource ? await scopedReadOwner(resource.run_id, a, g) : null;
    if (!owner) return reply.code(404).send(err("authority_denied", "Report not found.", crypto.randomUUID()));
    const report = await getReportForAccount(pool, reportId, owner);
    if (!report) return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
    const evidence = await loadOwnedExplanationEvidence(pool, { runId: report.run_id, accountId: owner, report });
    return {
      reportId: report.id,
      runId: report.run_id,
      version: report.version,
      outcome: report.outcome,
      blocks: report.blocks,
      claims: evidence.claims.map((claim) => ({ id: claim.id, text: claim.text })),
      limitations: report.limitations,
      sourceAccessSummary: report.source_access_summary,
      changeSummary: report.change_summary,
      routeMode: report.route_mode,
      labeledDemo: report.route_mode === "fixture",
    };
  });

  app.get("/v1/sources/:id", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const passageId = (req.params as { id: string }).id;
    const resource = (await pool.query<{ run_id: string }>("SELECT run_id FROM passages WHERE id=$1", [passageId])).rows[0];
    const owner = resource ? await scopedReadOwner(resource.run_id, a, g) : null;
    if (!owner) return reply.code(404).send(err("authority_denied", "Source not found.", crypto.randomUUID()));
    const row = await getPassageForAccount(pool, passageId, owner);
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
      effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
      applicableVersion: row.applicable_version ?? null,
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
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const sourceId = (req.params as { id: string }).id;
    const source = (await pool.query<{ run_id: string }>("SELECT run_id FROM sources WHERE id=$1", [sourceId])).rows[0];
    const owner = source ? await scopedReadOwner(source.run_id, a, g) : null;
    if (!owner) return reply.code(404).send(err("authority_denied", "Source not found.", crypto.randomUUID()));
    const authority = g ? { kind: "guest" as const, context: g, runId: source!.run_id }
      : owner !== a.accountId ? { kind: "claimed" as const, memberAccountId: a.accountId, runId: source!.run_id }
        : undefined;
    const result = await deleteSourceForAccount(pool, owner, sourceId, authority);
    try { await drainFileDeletions(pool, config.storageDir, owner); }
    catch { logError("file_deletion_deferred", { reason: "database_or_storage_unavailable" }); }
    const pending = await pool.query("SELECT 1 FROM file_deletion_outbox WHERE account_id=$1 AND state <> 'deleted' LIMIT 1", [owner]);
    return { ...result, fileCleanupPending: pending.rowCount !== 0 };
  });

  app.get("/v1/library", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { items: [...await listLibrary(pool, a.accountId), ...await listClaimedGuestParents(pool, a.accountId)]
      .sort((left, right) => right.created_at.getTime() - left.created_at.getTime()).slice(0, 100) };
  });

  app.post("/v1/reports/:id/challenges", async (req, reply) => {
    const a = await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const report = await getReportForAccount(pool, (req.params as { id: string }).id, a.accountId);
    if (!report) {
      const reportId = (req.params as { id: string }).id;
      const parent = (await pool.query<{ run_id: string }>("SELECT run_id FROM reports WHERE id=$1", [reportId])).rows[0];
      if (!parent || !await claimedConversationScope(pool, a.accountId, parent.run_id))
        return reply.code(404).send(err("permission_denied", "Report not found.", crypto.randomUUID()));
      const key = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).safeParse(req.headers["idempotency-key"]);
      if (!key.success) return reply.code(400).send(err("invalid_input",
        "An explicit challenge identity is required.", crypto.randomUUID()));
      const body = (req.body ?? {}) as { claimId?: string; category?: string; note?: string; includeExcerpt?: boolean };
      try { return await insertClaimedReportChallenge(pool, a.accountId, parent.run_id, reportId,
        { idempotencyKey: key.data, claimId: body.claimId,
          category: z.enum([...OUTPUT_REPORT_CATEGORIES, "claim"]).parse(body.category ?? "other"), note: body.note,
          includeExcerpt: body.includeExcerpt }); }
      catch (error) { return guestError(reply, error); }
    }
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
    const reportId = (req.params as { id: string }).id;
    const resource = (await pool.query<{ run_id: string }>("SELECT run_id FROM reports WHERE id=$1", [reportId])).rows[0];
    const owner = resource ? await scopedReadOwner(resource.run_id, a, null) : null;
    if (!owner) return reply.code(404).send(err("authority_denied", "Report not found.", crypto.randomUUID()));
    const md = await exportReportForAccount(pool, reportId, owner);
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

  app.delete("/v1/guest", async (req, reply) => {
    const context = await guest(req as never);
    if (!context) return reply.code(403).send(err("authority_denied", "Guest proof is no longer valid.", crypto.randomUUID()));
    return performDeletion({ accountId: context.accountId }, reply, false);
  });

  app.register(async (scope) => {
    // Encapsulation keeps every ordinary JSON endpoint on Fastify's validated parser.
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 256 * 1024 },
      (_req, body, done) => done(null, body));
    scope.post("/v1/clerk/webhooks", async (req, reply) => {
      if (!config.clerkAuth || !config.clerkWebhook || req.headers.authorization ||
          req.headers["x-norrow-guest-proof"])
        return reply.code(403).send(err("authority_denied", "Webhook not accepted.", crypto.randomUUID()));
      let event;
      try {
        event = await verifyClerkWebhook(req.body as Buffer, req.headers, {
          signingSecret: config.clerkWebhook.signingSecret,
          expectedInstanceId: config.clerkWebhook.instanceId,
          issuer: config.clerkAuth.issuer,
        });
      } catch {
        return reply.code(401).send(err("authority_denied", "Webhook not accepted.", crypto.randomUUID()));
      }
      try {
        const receipt = await applyClerkWebhookEvent(pool, event);
        return { accepted: true, reused: receipt.reused };
      } catch (error) {
        if ((error as Error).message === "clerk_webhook_replay_mismatch")
          return reply.code(409).send(err("idempotency_conflict", "Webhook receipt mismatch.", crypto.randomUUID()));
        throw error;
      }
    });
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
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
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
      allowance: g ? { availableMicro: Math.max(0, Number(allow.rows[0]?.limit_micro ?? 0) -
        Number(allow.rows[0]?.settled_micro ?? 0) - Number(allow.rows[0]?.reserved_micro ?? 0)),
        sponsoredFirstTurnOnly: true } : allow.rows[0] ?? null,
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
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    return { capabilities: pinRouteCapabilities(config), paidProbe: false };
  });

  app.get("/v1/runs/:id/cost", async (req, reply) => {
    const g = await guest(req as never);
    const a = g ? { accountId: g.accountId, deleted: false } : await auth(req as never);
    if (!a) return reply.code(401).send(err("permission_denied", "Sign in required.", crypto.randomUUID()));
    const id = (req.params as { id: string }).id;
    const owner = await scopedReadOwner(id, a, g);
    if (!owner) return reply.code(404).send(err("authority_denied", "Run not found.", crypto.randomUUID()));
    const cost = await measureRunCost(pool, id, owner);
    if (!cost) return reply.code(404).send(err("permission_denied", "Run not found.", crypto.randomUUID()));
    return cost;
  });

  // Test-only publish helper is not exposed. Tests import publishReport.
  void publishReport;
  return app;
}
