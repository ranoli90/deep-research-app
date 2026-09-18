import { authorizePublicQuery, classifyQueryTerms, type QueryAuthorization } from "./query-intelligence.js";

export const RECONCILIATION_VERSION = "document-web-reconciliation.v1";
export const RECONCILIATION_OUTCOMES = [
  "confirmed",
  "partially_confirmed",
  "contradicted",
  "outdated",
  "unverifiable",
  "blocked_by_access",
] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export type DocumentClaim = {
  key: string;
  text: string;
  scope?: string;
  date?: string;
  version?: string;
};

export type PublicEvidence = {
  sourceId: string;
  accessLevel: string;
  text: string;
  date?: string;
  blocked?: boolean;
};

export type ReconciliationResult = {
  version: typeof RECONCILIATION_VERSION;
  claimKey: string;
  outcome: ReconciliationOutcome;
  permissionRequired: boolean;
  queryAuthorization: QueryAuthorization;
  sourceScope: { sourceIds: string[]; accessLevels: string[] };
  rationale: string;
};

const STOP = new Set("a an the of and or in on for to is are was were be as at by from with that this it its per".split(" "));
const tokens = (s: string) => new Set((s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOP.has(t)));
const numbers = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/**
 * Compare a private-document claim to public evidence. Constructs a safe query;
 * does not summarize the document; private-only terms stay behind approval.
 */
export function reconcileDocumentClaim(args: {
  question: string;
  claim: DocumentClaim;
  documentText: string;
  publicEvidence: readonly PublicEvidence[];
  approvedPrivateTerms?: readonly string[];
  privateCanaries?: readonly string[];
}): ReconciliationResult {
  const documentText = `${args.documentText} ${args.claim.text}`;
  const auth = authorizePublicQuery({
    question: args.question,
    query: args.question,
    privateDocumentText: documentText,
    approvedPrivateTerms: args.approvedPrivateTerms,
    privateCanaries: args.privateCanaries,
    expand: true,
  });
  const claimTerms = classifyQueryTerms({
    question: args.question,
    query: args.claim.text,
    privateDocumentText: documentText,
    approvedPrivateTerms: args.approvedPrivateTerms,
  });
  const privateClaimTerms = claimTerms
    .filter((t) => t.provenance === "private-document-derived")
    .filter((t) => !(args.approvedPrivateTerms ?? []).some((a) => a.normalize("NFKC").toLowerCase() === t.token));
  const gated =
    privateClaimTerms.length && auth.kind === "authorized"
      ? {
          ...auth,
          kind: "permission_required" as const,
          reason: "private_derived_terms_require_approval",
          privateTermsRequiringApproval: privateClaimTerms.map((t) => t.token),
        }
      : auth;
  const sourceScope = {
    sourceIds: args.publicEvidence.map((e) => e.sourceId),
    accessLevels: [...new Set(args.publicEvidence.map((e) => e.accessLevel))],
  };
  const base: Omit<ReconciliationResult, "outcome" | "rationale"> = {
    version: RECONCILIATION_VERSION,
    claimKey: args.claim.key,
    queryAuthorization: gated,
    sourceScope,
    permissionRequired: gated.kind === "permission_required",
  };
  if (gated.kind === "blocked") {
    return { ...base, outcome: "unverifiable", rationale: gated.reason ?? "public_query_blocked", permissionRequired: false };
  }
  if (gated.kind === "permission_required") {
    return {
      ...base,
      outcome: "unverifiable",
      permissionRequired: true,
      rationale: "Private-derived terms require approval before public verification.",
    };
  }
  const blocked = args.publicEvidence.filter((e) => e.blocked || e.accessLevel === "blocked" || e.accessLevel === "failed");
  const readable = args.publicEvidence.filter((e) => !blocked.includes(e) && ["snippet", "abstract", "partial-text", "full-text"].includes(e.accessLevel));
  if (!args.publicEvidence.length) {
    return { ...base, outcome: "unverifiable", rationale: "No public evidence was inspected; absence is not disconfirmation." };
  }
  if (blocked.length && !readable.length) {
    return { ...base, outcome: "blocked_by_access", rationale: "Public sources needed for verification were inaccessible." };
  }
  const claimTokens = tokens(args.claim.text);
  const claimNumbers = numbers(args.claim.text);
  const contradiction = /\b(does not|is not|no longer|contradict)\b/i;
  let support = 0;
  let contra = 0;
  let outdated = 0;
  for (const ev of readable) {
    const evTokens = tokens(ev.text);
    const hit = overlap(claimTokens, evTokens) >= Math.min(3, Math.max(2, Math.floor(claimTokens.size / 3)));
    if (!hit) continue;
    const evNumbers = numbers(ev.text);
    const numberMismatch = claimNumbers.length > 0 && evNumbers.length > 0 && claimNumbers.some((n) => !evNumbers.includes(n));
    if (numberMismatch || (contradiction.test(ev.text) && !contradiction.test(args.claim.text))) contra += 1;
    else support += 1;
    if (numberMismatch && args.claim.date && ev.date && ev.date > args.claim.date && /price|cost|current/i.test(args.claim.text)) outdated += 1;
  }
  if (contra && support) {
    return { ...base, outcome: "partially_confirmed", rationale: "Public evidence both supports and contradicts the claim; scopes were not collapsed." };
  }
  if (outdated && !support) return { ...base, outcome: "outdated", rationale: "A later public source updates the document figure." };
  if (contra) return { ...base, outcome: "contradicted", rationale: "Public evidence contradicts the document claim." };
  if (support) return { ...base, outcome: "confirmed", rationale: "Public evidence confirms the document claim within inspected source scope." };
  return { ...base, outcome: "unverifiable", rationale: "Inspected public evidence neither confirms nor contradicts the claim." };
}
