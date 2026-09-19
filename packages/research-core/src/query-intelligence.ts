import { queryLeaksPrivate } from "./injection.js";

export const QUERY_INTELLIGENCE_VERSION = "query-provenance.v2";
export const QUERY_PROVENANCE = [
  "user-public",
  "safe-application-derived",
  "public-evidence-derived",
  "private-document-derived",
  "unclassified",
] as const;
export type QueryProvenance = (typeof QUERY_PROVENANCE)[number];
export type ExpansionKind =
  | "synonym"
  | "abbreviation"
  | "canonical"
  | "source-type-qualifier"
  | "industry"
  | "regulatory";
export type ClassifiedTerm = {
  token: string;
  provenance: QueryProvenance;
  expansionKind?: ExpansionKind;
};
export type QueryAuthorization = {
  kind: "authorized" | "permission_required" | "blocked";
  query: string;
  terms: ClassifiedTerm[];
  reason?: string;
  privateTermsRequiringApproval: string[];
};

const STOP = new Set(
  "a an the of and or in on for to is are was were be as at by from with that this it its vs versus how what which does do can current now today".split(" "),
);
const MAX_EXPANSION_TERMS = 6;
const TOKEN = /[\p{L}\p{N}]+/gu;

/** Bounded application lexicon. Never copied from source text. */
const LEXICON: Record<string, { terms: string[]; kind: ExpansionKind }> = {
  price: { terms: ["pricing", "msrp"], kind: "synonym" },
  pricing: { terms: ["price"], kind: "synonym" },
  cost: { terms: ["price", "pricing"], kind: "synonym" },
  compatible: { terms: ["compatibility"], kind: "synonym" },
  compatibility: { terms: ["compatible", "interop"], kind: "synonym" },
  statute: { terms: ["legislation", "regulation"], kind: "regulatory" },
  law: { terms: ["statute", "regulation"], kind: "regulatory" },
  regulation: { terms: ["regulator", "guidance"], kind: "regulatory" },
  fda: { terms: ["food", "drug", "administration"], kind: "abbreviation" },
  gdp: { terms: ["gross", "domestic", "product"], kind: "abbreviation" },
  gdpr: { terms: ["general", "data", "protection", "regulation"], kind: "abbreviation" },
  postgres: { terms: ["postgresql"], kind: "canonical" },
  postgresql: { terms: ["postgres"], kind: "canonical" },
  gpu: { terms: ["graphics", "processor"], kind: "abbreviation" },
  api: { terms: ["application", "programming", "interface"], kind: "abbreviation" },
  funding: { terms: ["financing", "investment"], kind: "industry" },
  revenue: { terms: ["turnover"], kind: "industry" },
};
const CANONICAL_PUBLIC = new Set(
  "postgresql postgres gdpr iso ieee usb json sql osha fda ema sec gaap ifrs hipaa nist kubernetes docker linux android ios windows macos aws azure gcp wifi bluetooth http https".split(" "),
);
const CLASS_QUALIFIERS: Record<string, string[]> = {
  "first-party-pricing": ["official", "pricing"],
  "vendor-docs": ["vendor", "documentation"],
  "release-notes": ["release", "notes"],
  "repository-tests": ["repository", "tests"],
  "statute-regulator": ["statute", "regulator", "guidance"],
  "primary-literature": ["primary", "literature"],
  "systematic-review": ["systematic", "review"],
  "filings": ["filing", "sec"],
  "investor-materials": ["investor"],
  "docs-source-issues-benchmarks": ["docs", "benchmark"],
  "independent-review": ["independent", "review"],
  "community": ["community"],
};

export function tokenizeQuery(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(TOKEN) ?? [];
}

function unique(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Stable preimage for a query authorization digest. Does not hash. */
export function canonicalQueryIdentity(query: string): string {
  return unique(tokenizeQuery(query)).join("\0");
}

export function canonicalPrivateTermSet(terms: readonly string[]): string[] {
  return unique(terms.map((t) => t.normalize("NFKC").toLowerCase()).filter(Boolean)).sort();
}

export function privateTermSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  return canonicalPrivateTermSet(a).join("\0") === canonicalPrivateTermSet(b).join("\0");
}

function expansionsFor(token: string): { terms: string[]; kind: ExpansionKind } | undefined {
  return LEXICON[token];
}

export function isCanonicalPublicTerm(token: string): boolean {
  return CANONICAL_PUBLIC.has(token.normalize("NFKC").toLowerCase());
}

function setOf(text: string | undefined): Set<string> {
  return new Set(text ? tokenizeQuery(text) : []);
}

function privateMarkers(document: string | undefined, question: string): Set<string> {
  if (!document) return new Set();
  const q = setOf(question);
  const out = new Set<string>();
  for (const m of document.match(/CANARY:[A-Z0-9_-]+/gi) ?? []) {
    for (const t of tokenizeQuery(m)) if (!q.has(t)) out.add(t);
  }
  for (const m of document.match(/\b[A-Z][A-Za-z0-9]{3,}\b/g) ?? []) {
    const t = m.toLowerCase();
    if (!q.has(t) && !isCanonicalPublicTerm(t)) out.add(t);
  }
  return out;
}

/** Classify each query token. Source-text bait never authorizes a public term. */
export function classifyQueryTerms(args: {
  question: string;
  query: string;
  privateDocumentText?: string;
  publicEvidenceText?: string;
  sourceTextBait?: string;
  approvedPrivateTerms?: readonly string[];
  safeApplicationTerms?: readonly ClassifiedTerm[];
}): ClassifiedTerm[] {
  const question = setOf(args.question);
  const document = setOf(args.privateDocumentText);
  const publicEvidence = setOf(args.publicEvidenceText);
  const bait = setOf(args.sourceTextBait);
  const approved = new Set((args.approvedPrivateTerms ?? []).map((t) => t.normalize("NFKC").toLowerCase()));
  const privateOnly = privateMarkers(args.privateDocumentText, args.question);
  const questionExpansions = new Map<string, ExpansionKind>();
  for (const token of question) {
    const exp = expansionsFor(token);
    if (!exp) continue;
    for (const extra of exp.terms) questionExpansions.set(extra, exp.kind);
  }
  for (const extra of args.safeApplicationTerms ?? []) questionExpansions.set(extra.token, extra.expansionKind ?? "synonym");
  return unique(tokenizeQuery(args.query)).map((token) => {
    if (question.has(token)) return { token, provenance: "user-public" as const };
    const kind = questionExpansions.get(token);
    if (kind) return { token, provenance: "safe-application-derived" as const, expansionKind: kind };
    if (bait.has(token) && !question.has(token) && !publicEvidence.has(token)) {
      return { token, provenance: "private-document-derived" as const };
    }
    if (publicEvidence.has(token) && !document.has(token)) {
      return { token, provenance: "public-evidence-derived" as const };
    }
    if (document.has(token) && isCanonicalPublicTerm(token) && !bait.has(token)) {
      return { token, provenance: "public-evidence-derived" as const, expansionKind: "canonical" };
    }
    if (privateOnly.has(token) || (approved.has(token) && !question.has(token))) {
      return { token, provenance: "private-document-derived" as const };
    }
    if (document.has(token) && !question.has(token) && !isCanonicalPublicTerm(token) && !/^\d+$/.test(token) && token.length >= 6 && !STOP.has(token)) {
      return { token, provenance: "private-document-derived" as const };
    }
    if (STOP.has(token)) return { token, provenance: "safe-application-derived" as const };
    return { token, provenance: "unclassified" as const };
  });
}

export function expandSafeTerms(args: {
  question: string;
  sourceClass?: string;
}): ClassifiedTerm[] {
  const questionTokens = unique(tokenizeQuery(args.question)).filter((t) => !STOP.has(t));
  const extras: ClassifiedTerm[] = [];
  const seen = new Set(questionTokens);
  for (const token of questionTokens) {
    const exp = expansionsFor(token);
    if (!exp) continue;
    for (const extra of exp.terms) {
      if (seen.has(extra) || extras.length >= MAX_EXPANSION_TERMS) continue;
      seen.add(extra);
      extras.push({ token: extra, provenance: "safe-application-derived", expansionKind: exp.kind });
    }
  }
  const qualifiers = args.sourceClass ? CLASS_QUALIFIERS[args.sourceClass] ?? [] : [];
  for (const extra of qualifiers) {
    if (seen.has(extra) || extras.length >= MAX_EXPANSION_TERMS) continue;
    seen.add(extra);
    extras.push({ token: extra, provenance: "safe-application-derived", expansionKind: "source-type-qualifier" });
  }
  return extras;
}

export function authorizePublicQuery(args: {
  question: string;
  query: string;
  privateDocumentText?: string;
  publicEvidenceText?: string;
  sourceTextBait?: string;
  approvedPrivateTerms?: readonly string[];
  privateCanaries?: readonly string[];
  sourceClass?: string;
  expand?: boolean;
}): QueryAuthorization {
  const leak = queryLeaksPrivate(args.query, [...(args.privateCanaries ?? [])]);
  const publicBase = unique(tokenizeQuery(args.question)).join(" ");
  if (leak) {
    return {
      kind: "blocked",
      query: publicBase,
      terms: [],
      reason: "private_query_blocked",
      privateTermsRequiringApproval: [leak],
    };
  }
  const extras = args.expand === false ? [] : expandSafeTerms({ question: args.question, sourceClass: args.sourceClass });
  const extraTokens = extras.map((t) => t.token);
  const expandedQuery = unique([...tokenizeQuery(args.query), ...extraTokens]).join(" ");
  const expandedLeak = queryLeaksPrivate(expandedQuery, [...(args.privateCanaries ?? [])]);
  if (expandedLeak) {
    return {
      kind: "blocked",
      query: publicBase,
      terms: [],
      reason: "private_query_blocked",
      privateTermsRequiringApproval: [expandedLeak],
    };
  }
  const terms = classifyQueryTerms({ ...args, query: expandedQuery, safeApplicationTerms: extras });
  const unapprovedPrivate = terms
    .filter((t) => t.provenance === "private-document-derived")
    .filter((t) => !(args.approvedPrivateTerms ?? []).some((a) => a.normalize("NFKC").toLowerCase() === t.token))
    .map((t) => t.token);
  const unclassified = terms.filter((t) => t.provenance === "unclassified").map((t) => t.token);
  const bait = setOf(args.sourceTextBait);
  const question = setOf(args.question);
  if ([...bait].some((t) => tokenizeQuery(expandedQuery).includes(t) && !question.has(t) && !isCanonicalPublicTerm(t))) {
    return {
      kind: "blocked",
      query: publicBase,
      terms,
      reason: "source_text_cannot_authorize_public_query",
      privateTermsRequiringApproval: unique(unapprovedPrivate),
    };
  }
  if (unclassified.length) {
    return {
      kind: "blocked",
      query: publicBase,
      terms,
      reason: "unclassified_query_terms",
      privateTermsRequiringApproval: unique(unapprovedPrivate),
    };
  }
  if (unapprovedPrivate.length) {
    return {
      kind: "permission_required",
      query: publicBase,
      terms,
      reason: "private_derived_terms_require_approval",
      privateTermsRequiringApproval: unique(unapprovedPrivate),
    };
  }
  return {
    kind: "authorized",
    query: extraTokens.length ? expandedQuery : args.query,
    terms,
    privateTermsRequiringApproval: [],
  };
}
