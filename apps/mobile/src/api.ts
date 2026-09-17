const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

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

async function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e instanceof Error && e.name === "AbortError" ? "The API did not respond. Check the connection." : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => req("/health"),
  session: () => req("/v1/dev/session", { method: "POST", body: "{}" }) as Promise<Session>,
  consent: (token: string, grant: boolean) => req("/v1/consent", { method: "POST", token, body: JSON.stringify({ grant }) }),
  createRun: (token: string, question: string, routeMode: string, idempotencyKey: string, attachmentIds: string[] = []) =>
    req("/v1/runs", {
      method: "POST",
      token,
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ question, routeMode, attachmentIds }),
    }),
  attach: (token: string, filename: string, mime: string, text: string) =>
    req("/v1/attachments", { method: "POST", token, body: JSON.stringify({ filename, mime, text }) }),
  continueRun: (token: string, id: string, geography: string) =>
    req(`/v1/runs/${id}/continue`, { method: "POST", token, body: JSON.stringify({ geography }) }),
  getRun: (token: string, id: string) => req(`/v1/runs/${id}`, { token }),
  events: (token: string, id: string, after = 0) => req(`/v1/runs/${id}/events?after=${after}`, { token }),
  cancel: (token: string, id: string) => req(`/v1/runs/${id}/cancel`, { method: "POST", token, body: "{}" }),
  correct: (token: string, id: string, expectedBriefRevision: number, correctionText: string) =>
    req(`/v1/runs/${id}/corrections`, {
      method: "POST",
      token,
      headers: { "idempotency-key": `${id}-corr-${expectedBriefRevision}` },
      body: JSON.stringify({ expectedBriefRevision, correctionText }),
    }),
  followUp: (token: string, id: string, claimId: string, note: string) =>
    req(`/v1/runs/${id}/follow-up`, {
      method: "POST",
      token,
      body: JSON.stringify({ claimId, note }),
    }),
  report: (token: string, id: string) => req(`/v1/reports/${id}`, { token }),
  source: (token: string, id: string) => req(`/v1/sources/${id}`, { token }),
  library: (token: string) => req("/v1/library", { token }),
  exportMd: (token: string, id: string) => req(`/v1/reports/${id}/export`, { token }),
  challenge: (token: string, reportId: string, claimId: string, note: string) =>
    req(`/v1/reports/${reportId}/challenges`, { method: "POST", token, body: JSON.stringify({ claimId, category: "claim", note }) }),
  settings: (token: string) => req("/v1/settings", { token }),
  deleteAccount: (token: string) => req("/v1/account/deletion", { method: "POST", token, body: "{}" }),
};
