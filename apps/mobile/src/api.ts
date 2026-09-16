const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

export type Session = { token: string; accountId: string };

async function req(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  health: () => req("/health"),
  session: () => req("/v1/dev/session", { method: "POST", body: "{}" }) as Promise<Session>,
  consent: (token: string, grant: boolean) => req("/v1/consent", { method: "POST", token, body: JSON.stringify({ grant }) }),
  createRun: (token: string, question: string, routeMode: string, idempotencyKey: string) =>
    req("/v1/runs", {
      method: "POST",
      token,
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ question, routeMode }),
    }),
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
  report: (token: string, id: string) => req(`/v1/reports/${id}`, { token }),
  source: (token: string, id: string) => req(`/v1/sources/${id}`, { token }),
  library: (token: string) => req("/v1/library", { token }),
  exportMd: (token: string, id: string) => req(`/v1/reports/${id}/export`, { token }),
  challenge: (token: string, reportId: string, claimId: string, note: string) =>
    req(`/v1/reports/${reportId}/challenges`, { method: "POST", token, body: JSON.stringify({ claimId, category: "claim", note }) }),
  settings: (token: string) => req("/v1/settings", { token }),
  deleteAccount: (token: string) => req("/v1/account/deletion", { method: "POST", token, body: "{}" }),
};
