import type { QueryProvenance, ClassifiedTerm, ExpansionKind } from "./query-intelligence.js";
import { authorizePublicQuery, classifyQueryTerms, expandSafeTerms } from "./query-intelligence.js";

export const QUERY_PLAN_VERSION = "typed-query-plan.v1";

export type PlannedQueryTerm = ClassifiedTerm & {
  source: "question" | "lexicon" | "standard" | "public_evidence" | "source_class";
};

export type TypedQueryPlan = {
  version: typeof QUERY_PLAN_VERSION;
  seed: string;
  terms: PlannedQueryTerm[];
  expansions: { token: string; kind: ExpansionKind; provenance: QueryProvenance }[];
  privateTermsRequiringApproval: string[];
};

const STANDARDS: Record<string, string[]> = {
  usb: ["usb-if"],
  wifi: ["ieee 802.11"],
  bluetooth: ["bluetooth sig"],
  gdpr: ["regulation (eu) 2016/679"],
  hipaa: ["45 cfr"],
};

/** Provenanced plan. Private-document-only terms never expand without exact approval. */
export function planTypedQuery(args: {
  question: string;
  query: string;
  privateDocumentText?: string;
  approvedPrivateTerms?: string[];
  publicEvidenceTerms?: string[];
}): TypedQueryPlan {
  const classified = classifyQueryTerms({
    question: args.question,
    query: args.query,
    privateDocumentText: args.privateDocumentText ?? "",
    approvedPrivateTerms: args.approvedPrivateTerms ?? [],
    publicEvidenceText: (args.publicEvidenceTerms ?? []).join(" "),
  });
  const expansion = expandSafeTerms({ question: args.question });
  const authorized = authorizePublicQuery({
    question: args.question,
    query: args.query,
    privateDocumentText: args.privateDocumentText ?? "",
    approvedPrivateTerms: args.approvedPrivateTerms ?? [],
  });
  const terms: PlannedQueryTerm[] = classified.map((t) => ({
    ...t,
    source: t.provenance === "user-public" ? "question" : t.provenance === "safe-application-derived" ? "lexicon" : t.provenance === "public-evidence-derived" ? "public_evidence" : "question",
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
  };
}
