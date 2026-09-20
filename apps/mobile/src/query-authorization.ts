const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type PendingQueryAuthorization = {
  id: string;
  proposedQuery: string;
  queryDigest: string;
  briefRevision: number;
  terms: string[];
  reason?: string | null;
};

function fail(): Error {
  return new Error("Pending search approval is invalid. Public search will not continue.");
}

/** Server-issued exact terms. Malformed pending rows fail closed instead of authorizing a search. */
export function readPendingQueryAuthorization(value: unknown): PendingQueryAuthorization | null {
  if (value == null) return null;
  if (!record(value)) throw fail();
  if (typeof value.id !== "string" || !uuid.test(value.id)) throw fail();
  if (typeof value.proposedQuery !== "string" || !value.proposedQuery.trim() || value.proposedQuery.length > 4000) throw fail();
  if (typeof value.queryDigest !== "string" || !digest.test(value.queryDigest)) throw fail();
  if (typeof value.briefRevision !== "number" || !Number.isSafeInteger(value.briefRevision) || value.briefRevision <= 0) throw fail();
  if (!Array.isArray(value.terms) || value.terms.length > 200) throw fail();
  const terms: string[] = [];
  for (const term of value.terms) {
    if (typeof term !== "string" || !term.trim() || term.length > 1000) throw fail();
    terms.push(term.trim());
  }
  const reason = value.reason === undefined || value.reason === null || typeof value.reason === "string" ? (value.reason as string | null | undefined) : undefined;
  if (value.reason !== undefined && value.reason !== null && typeof value.reason !== "string") throw fail();
  return {
    id: value.id,
    proposedQuery: value.proposedQuery,
    queryDigest: value.queryDigest,
    briefRevision: value.briefRevision,
    terms,
    ...(reason !== undefined ? { reason } : {}),
  };
}

export function queryAuthorizationPending(run: {
  lifecycle?: string;
  pendingQueryAuthorization?: PendingQueryAuthorization | null;
  pendingInput?: { type?: string; id?: string; briefRevision?: number; field?: string | null } | null;
} | null | undefined): boolean {
  if (!run || run.lifecycle !== "awaiting_input") return false;
  return run.pendingInput?.type === "query_authorization";
}

/** Approve only the exact server-issued id, digest, and term set. Never invent terms. */
export function queryAuthorizationApproveBody(pending: PendingQueryAuthorization | null | undefined): {
  authorizationId: string;
  queryDigest: string;
  terms: string[];
} {
  if (!pending) throw new Error("Exact search terms are not available. Public search will not continue.");
  return {
    authorizationId: pending.id,
    queryDigest: pending.queryDigest,
    terms: [...pending.terms],
  };
}
