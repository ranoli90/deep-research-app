import { CorrectionRequestSchema, RequestedVerificationRequestSchema, type RequestedVerificationRequest,type ResearchCorrectionPatch } from "@deep/contracts";
import { createRequestScope, SupersededRequest } from "./request-scope";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const backendUrl = API;
const requests = createRequestScope();
export const isSupersededRequest = (error: unknown): boolean => error instanceof SupersededRequest;

/** Browser deletion path (M09). No secrets in the URL. */
export const deletionPageUrl = `${API}/account/deletion`;

export type Session = { token: string; accountId: string };

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

/** Fetch failures and timeouts are mapped to ApiError status 0. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

async function req(path: string, init: RequestInit & { token?: string; scope?: "account" | "view" | "source"; runId?: string } = {}) {
  const lease = requests.capture(init.scope ?? "account", init.token, init.runId);
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
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
  selectRun: requests.selectRun,
  closeSource: requests.closeSource,
  invalidateView: requests.invalidateView,
  currentRun: requests.currentRun,
  capture: () => requests.capture("account"),
  captureView: () => requests.capture("view"),
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
  continueRun: (token: string, id: string, geography: string) =>
    req(`/v1/runs/${id}/continue`, { method: "POST", token, scope: "view", runId: id, body: JSON.stringify({ geography }) }),
  getRun: (token: string, id: string) => req(`/v1/runs/${id}`, { token, scope: "view", runId: id }),
  events: (token: string, id: string, after = 0) => req(`/v1/runs/${id}/events?after=${after}`, { token, scope: "view", runId: id }),
  cancel: (token: string, id: string) => req(`/v1/runs/${id}/cancel`, { method: "POST", token, body: "{}" }),
  correct: (token: string, id: string, expectedBriefRevision: number, correctionText: string, patch?:ResearchCorrectionPatch) =>
    req(`/v1/runs/${id}/corrections`, {
      method: "POST",
      token,
      scope: "view", runId: id,
      headers: { "idempotency-key": `${id}-corr-${expectedBriefRevision}` },
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
};
