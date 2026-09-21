import { AssumptionsRequestSchema, ContinueRunRequestSchema, CorrectionRequestSchema, FollowUpMessageRequestSchema, RequestedVerificationRequestSchema, type AssumptionsRequest, type ContinueRunRequest, type RequestedVerificationRequest,type ResearchCorrectionPatch } from "@deep/contracts";
import { createRequestScope, SupersededRequest } from "./request-scope";
import type { GuestPendingAction } from "./auth/guest-pending-action";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const backendUrl = API;
const requests = createRequestScope();
export const isSupersededRequest = (error: unknown): boolean => error instanceof SupersededRequest;

/** Browser deletion path (M09). No secrets in the URL. */
export const deletionPageUrl = `${API}/account/deletion`;

export type Session = { token: string; accountId: string };

/** Guest proof is deliberately absent from the general member transport. */
const GUEST_PROOF_ROUTES = [
  ["GET", /^\/v1\/session$/], ["GET", /^\/v1\/settings$/],
  ["POST", /^\/v1\/consent$/], ["POST", /^\/v1\/runs$/], ["POST", /^\/v1\/run-requests\/resolve$/],
  ["POST", /^\/v1\/guest\/pending-actions$/], ["POST", /^\/v1\/guest\/claim$/],
  ["GET", /^\/v1\/runs\/[0-9a-f-]+$/i], ["GET", /^\/v1\/runs\/[0-9a-f-]+\/events\?after=\d+$/i],
  ["GET", /^\/v1\/runs\/[0-9a-f-]+\/cost$/i], ["POST", /^\/v1\/runs\/[0-9a-f-]+\/cancel$/i],
  ["GET", /^\/v1\/reports\/[0-9a-f-]+$/i], ["GET", /^\/v1\/sources\/[0-9a-f-]+$/i],
  ["DELETE", /^\/v1\/sources\/[0-9a-f-]+$/i], ["DELETE", /^\/v1\/guest$/],
] as const;

function checkedGuestUrl(method: string, path: string): string {
  const origin = new URL(API);
  const local = ["127.0.0.1", "localhost", "::1"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Guest API origin is not trusted.");
  if (!GUEST_PROOF_ROUTES.some(([verb, pattern]) => verb === method && pattern.test(path))) throw new Error("Guest proof cannot be sent to this route.");
  return new URL(path, origin).toString();
}

async function guestReq(method: string, path: string, proof: string, body?: object, memberToken?: string, idempotencyKey?: string): Promise<any> {
  if (typeof proof !== "string" || proof.length < 32 || proof.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(proof)) throw new Error("Guest proof is unavailable.");
  const url = checkedGuestUrl(method, path);
  const headers: Record<string, string> = { "x-norrow-guest-proof": proof };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (memberToken) headers.authorization = `Bearer ${memberToken}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "error" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, typeof result?.code === "string" ? result.code : `Request failed (${response.status})`);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "Could not reach the research service. The saved message has not been sent again.");
  } finally { clearTimeout(timer); }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isExpiredSession(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export function isConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** Fetch failures and timeouts are mapped to ApiError status 0. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

async function req(path: string, init: RequestInit & { token?: string; scope?: "account" | "view" | "source"; runId?: string } = {}) {
  const lease = requests.capture(init.scope ?? "account", init.token, init.runId);
  const headers: Record<string, string> = { ...(init.body != null ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string>) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  lease.signal.addEventListener("abort", abort, { once: true });
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!lease.current() || init.signal?.aborted) throw new SupersededRequest();
    if (!res.ok) {
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    return body;
  } catch (e) {
    if (!lease.current() || init.signal?.aborted || e instanceof SupersededRequest) throw new SupersededRequest();
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e instanceof Error && e.name === "AbortError" ? "The API did not respond. Check the connection." : (e as Error).message);
  } finally {
    clearTimeout(timer);
    lease.signal.removeEventListener("abort", abort);
    init.signal?.removeEventListener("abort", abort);
    lease.release();
  }
}

export const api = {
  activateSession: requests.setSession,
  rotateCredential: requests.rotateCredential,
  sessionEpochs: requests.epochs,
  selectRun: requests.selectRun,
  closeSource: requests.closeSource,
  invalidateView: requests.invalidateView,
  currentRun: requests.currentRun,
  capture: (session?: string) => requests.capture("account", session),
  captureView: (session?: string, runId?: string) => requests.capture("view", session, runId),
  health: () => req("/health"),
  session: () => req("/v1/dev/session", { method: "POST", body: "{}" }) as Promise<Session>,
  sessionInfo: (token: string) => req("/v1/session", { token }) as Promise<{ accountId: string; authMode: string }>,
  consent: (token: string, grant: boolean) => req("/v1/consent", { method: "POST", token, body: JSON.stringify({ grant }) }),
  attachBytes: (token: string, filename: string, mime: string, bytes: Uint8Array, key?: string) =>
    req("/v1/attachments/bytes", { method: "POST", token, scope: "view",
      headers: { "content-type": "application/octet-stream", "x-document-mime": mime, "x-file-name": encodeURIComponent(filename), ...(key ? { "idempotency-key": key } : {}) },
      body: new Uint8Array(bytes).buffer }),
  createRun: (token: string, question: string, routeMode: string, idempotencyKey: string, attachmentIds: string[] = []) =>
    req("/v1/runs", {
      method: "POST",
      token,
      scope: "view",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ question, routeMode, attachmentIds }),
    }),
  resolveRunRequest: (token: string, idempotencyKey: string, verification?: { parentRunId: string; request: RequestedVerificationRequest }) => req("/v1/run-requests/resolve", { method: "POST", token, scope: "view", body: JSON.stringify({ idempotencyKey, ...(verification ? { verification } : {}) }) }),
  attach: (token: string, filename: string, mime: string, text: string, key?: string) =>
    req("/v1/attachments", { method: "POST", token, scope: "view", headers: key ? { "idempotency-key": key } : {}, body: JSON.stringify({ filename, mime, text }) }),
  continueRun: (token: string, id: string, body: ContinueRunRequest) =>
    req(`/v1/runs/${id}/continue`, {
      method: "POST",
      token,
      scope: "view",
      runId: id,
      body: JSON.stringify(ContinueRunRequestSchema.parse(body)),
    }),
  confirmAssumptions: (token: string, id: string, body: AssumptionsRequest, idempotencyKey?: string) =>
    req(`/v1/runs/${id}/assumptions`, {
      method: "POST",
      token,
      scope: "view",
      runId: id,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
      body: JSON.stringify(AssumptionsRequestSchema.parse(body)),
    }),
  approveQuery: (token: string, id: string, body: { authorizationId: string; queryDigest: string; terms: string[] }) =>
    req(`/v1/runs/${id}/query-authorizations/approve`, {
      method: "POST",
      token,
      scope: "view",
      runId: id,
      body: JSON.stringify(body),
    }),
  getRun: (token: string, id: string) => req(`/v1/runs/${id}`, { token, scope: "view", runId: id }),
  events: (token: string, id: string, after = 0) => req(`/v1/runs/${id}/events?after=${after}`, { token, scope: "view", runId: id }),
  cancel: (token: string, id: string) => req(`/v1/runs/${id}/cancel`, { method: "POST", token, body: "{}" }),
  correct: (token: string, id: string, expectedBriefRevision: number, correctionText: string, patch?:ResearchCorrectionPatch, idempotencyKey?: string) =>
    req(`/v1/runs/${id}/corrections`, {
      method: "POST",
      token,
      scope: "view", runId: id,
      headers: { "idempotency-key": idempotencyKey ?? `${id}-corr-${expectedBriefRevision}` },
      body: JSON.stringify(CorrectionRequestSchema.parse({ expectedBriefRevision, correctionText,...(patch?{patch}:{}) })),
    }),
  resolveCorrection: (token: string, id: string, expectedBriefRevision: number, correctionText: string, patch: ResearchCorrectionPatch) =>
    req(`/v1/runs/${id}/corrections/resolve`, { method: "POST", token, scope: "view", runId: id,
      body: JSON.stringify(CorrectionRequestSchema.parse({ expectedBriefRevision, correctionText, patch })) }),
  followUp: (token: string, id: string, request: RequestedVerificationRequest) =>
    req(`/v1/runs/${id}/follow-up`, {
      method: "POST",
      token,
      scope: "view", runId: id,
      body: JSON.stringify(RequestedVerificationRequestSchema.parse(request)),
    }),
  explainFollowUp: (token: string, id: string, body: { message: string; expectedBriefRevision?: number }, idempotencyKey?: string) =>
    req(`/v1/runs/${id}/follow-up`, {
      method: "POST",
      token,
      scope: "view",
      runId: id,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
      body: JSON.stringify(FollowUpMessageRequestSchema.parse(body)),
    }),
  report: (token: string, id: string) => req(`/v1/reports/${id}`, { token, scope: "view" }),
  deleteSource: (token: string, sourceId: string) => req(`/v1/sources/${sourceId}`, { method: "DELETE", token }),
  source: (token: string, id: string) => { requests.closeSource(); return req(`/v1/sources/${id}`, { token, scope: "source" }); },
  library: (token: string) => req("/v1/library", { token }),
  exportMd: (token: string, id: string) => req(`/v1/reports/${id}/export`, { token, scope: "view" }),
  challenge: (
    token: string,
    reportId: string,
    body: { claimId?: string; category: string; note: string; includeExcerpt: boolean },
  ) => req(`/v1/reports/${reportId}/challenges`, { method: "POST", token, scope: "view", body: JSON.stringify(body) }),
  restorePurchases: (token: string) =>
    req("/v1/purchases/restore", { method: "POST", token, body: "{}" }),
  settings: (token: string) => req("/v1/settings", { token }),
  deleteAccount: (token: string) => req("/v1/account/deletion", { method: "POST", token, body: "{}" }),
  guest: {
    bootstrap: () => req("/v1/guest/bootstrap", { method: "POST", body: "{}" }),
    sessionInfo: (proof: string) => guestReq("GET", "/v1/session", proof),
    settings: (proof: string) => guestReq("GET", "/v1/settings", proof),
    consent: (proof: string, grant: boolean) => guestReq("POST", "/v1/consent", proof, { grant }),
    createRun: (proof: string, question: string, idempotencyKey: string, conversationId: string) => guestReq("POST", "/v1/runs", proof, { question, routeMode: "controlled-research", attachmentIds: [], conversationId }, undefined, idempotencyKey),
    resolveRun: (proof: string, idempotencyKey: string) => guestReq("POST", "/v1/run-requests/resolve", proof, { idempotencyKey }),
    registerAction: (proof: string, action: GuestPendingAction) => guestReq("POST", "/v1/guest/pending-actions", proof, {
      submissionId: action.submissionId, guestContextId: action.guestContextId, conversationId: action.conversationId,
      conversationVersion: action.conversationVersion, payload: action.payload, payloadDigest: action.payloadDigest,
      consentPolicyVersion: action.consentPolicyVersion,
    }),
    claim: (proof: string, memberToken: string, action: GuestPendingAction) => guestReq("POST", "/v1/guest/claim", proof, {
      claimRequestId: action.claim?.requestId, submissionId: action.submissionId, guestContextId: action.guestContextId,
      conversationId: action.conversationId, conversationVersion: action.conversationVersion,
    }, memberToken),
    getRun: (proof: string, runId: string) => guestReq("GET", `/v1/runs/${runId}`, proof),
    events: (proof: string, runId: string, after = 0) => guestReq("GET", `/v1/runs/${runId}/events?after=${after}`, proof),
    report: (proof: string, reportId: string) => guestReq("GET", `/v1/reports/${reportId}`, proof),
    source: (proof: string, sourceId: string) => guestReq("GET", `/v1/sources/${sourceId}`, proof),
    cancel: (proof: string, runId: string) => guestReq("POST", `/v1/runs/${runId}/cancel`, proof, {}),
    deleteSource: (proof: string, sourceId: string) => guestReq("DELETE", `/v1/sources/${sourceId}`, proof),
    delete: (proof: string) => guestReq("DELETE", "/v1/guest", proof),
  },
  resolveGuestClaim: (token: string, claimRequestId: string, submissionId: string) => req("/v1/guest/claims/resolve", { method: "POST", token, body: JSON.stringify({ claimRequestId, submissionId }) }),
  resumeGuestAction: (token: string, action: GuestPendingAction) => req("/v1/guest/actions/resume", { method: "POST", token, body: JSON.stringify({ submissionId: action.submissionId, claimRequestId: action.claim?.requestId, controlVersion: action.claim?.controlVersion, payloadDigest: action.payloadDigest }) }),
  resolveGuestAction: (token: string, action: GuestPendingAction) => req("/v1/guest/actions/resolve", { method: "POST", token, body: JSON.stringify({ submissionId: action.submissionId, claimRequestId: action.claim?.requestId }) }),
};
