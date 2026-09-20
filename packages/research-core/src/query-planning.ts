import type { QueryProvenance, ClassifiedTerm, ExpansionKind, QueryAuthorization } from "./query-intelligence.js";
import { authorizePublicQuery, classifyQueryTerms, expandSafeTerms } from "./query-intelligence.js";

export const QUERY_PLAN_VERSION = "typed-query-plan.v2";

export type PlannedQueryTerm = ClassifiedTerm & {
  source: "question" | "lexicon" | "standard" | "public_evidence" | "source_class" | "private_document" | "unclassified";
};

export type TypedQueryPlan = {
  version: typeof QUERY_PLAN_VERSION;
  seed: string;
  terms: PlannedQueryTerm[];
  expansions: { token: string; kind: ExpansionKind; provenance: QueryProvenance }[];
  privateTermsRequiringApproval: string[];
  unclassifiedTerms: string[];
  authorizationKind: QueryAuthorization["kind"];
};

function termSource(t: ClassifiedTerm): PlannedQueryTerm["source"] {
  if (t.provenance === "user-public") return "question";
  if (t.provenance === "safe-application-derived") return t.expansionKind === "source-type-qualifier" ? "source_class" : "lexicon";
  if (t.provenance === "public-evidence-derived") return "public_evidence";
  if (t.provenance === "private-document-derived") return "private_document";
  return "unclassified";
}

const STANDARDS: Record<string, string[]> = {
  usb: ["usb-if"],
  wifi: ["ieee 802.11"],
  bluetooth: ["bluetooth sig"],
  gdpr: ["regulation (eu) 2016/679"],
  hipaa: ["45 cfr"],
};

/** Provenanced lexicon/standards plan. Not semantic reformulation; private/source wording never becomes a public query. */
export function planTypedQuery(args: {
  question: string;
  query: string;
  privateDocumentText?: string;
  approvedPrivateTerms?: string[];
  publicEvidenceTerms?: string[];
}): TypedQueryPlan {
  const publicEvidenceText = (args.publicEvidenceTerms ?? []).join(" ");
  const classified = classifyQueryTerms({
    question: args.question,
    query: args.query,
    privateDocumentText: args.privateDocumentText ?? "",
    approvedPrivateTerms: args.approvedPrivateTerms ?? [],
    publicEvidenceText,
  });
  const expansion = expandSafeTerms({ question: args.question });
  const authorized = authorizePublicQuery({
    question: args.question,
    query: args.query,
    privateDocumentText: args.privateDocumentText ?? "",
    approvedPrivateTerms: args.approvedPrivateTerms ?? [],
    publicEvidenceText,
  });
  const terms: PlannedQueryTerm[] = classified.map((t) => ({
    ...t,
    source: termSource(t),
  }));
  for (const [key, extras] of Object.entries(STANDARDS)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(args.query)) {
      for (const extra of extras) {
        terms.push({
          token: extra,
          provenance: "safe-application-derived",
          expansionKind: "canonical",
          source: "standard",
        });
      }
    }
  }
  for (const token of args.publicEvidenceTerms ?? []) {
    if (!token.trim()) continue;
    terms.push({ token: token.trim(), provenance: "public-evidence-derived", source: "public_evidence" });
  }
  return {
    version: QUERY_PLAN_VERSION,
    seed: args.query,
    terms,
    expansions: expansion
      .filter((t) => t.expansionKind)
      .map((t) => ({ token: t.token, kind: t.expansionKind!, provenance: t.provenance })),
    privateTermsRequiringApproval: authorized.privateTermsRequiringApproval,
    unclassifiedTerms: classified.filter((t) => t.provenance === "unclassified").map((t) => t.token),
    authorizationKind: authorized.kind,
  };
}
