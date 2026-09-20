export const FRESHNESS_POLICY_VERSIONS = ["criterion-freshness.v2", "criterion-freshness.v3"] as const;
export type FreshnessPolicyVersion = (typeof FRESHNESS_POLICY_VERSIONS)[number];
/** New writes. Readers must accept v2 | v3; do not rewrite stored v2 rows. */
export const FRESHNESS_POLICY_VERSION: FreshnessPolicyVersion = "criterion-freshness.v3";
export const FRESHNESS_CLASSES = ["price", "law", "compatibility", "historical", "science", "generic"] as const;
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];
export type FreshnessPolicy = {
  version: FreshnessPolicyVersion;
  class: FreshnessClass;
  maxAgeHours: number | null;
  requiresEffectiveDate: boolean;
  requiresVersion: boolean;
  rationale: string;
};
export type FreshnessEvaluation = "fresh" | "stale" | "historical-preferred" | "unknown";

export type FreshnessCriterionInput = {
  key: string;
  field?: string | null;
  description?: string | null;
  importance?: string | null;
  provenance?: { start: number; end: number; quote: string } | null;
  scope?: Record<string, string | null> | null;
};

export type FreshnessBoundSource = {
  publicationDate?: Date | null;
  effectiveDate?: Date | null;
  version?: string | null;
  retrievedAt?: Date | null;
};

export type DiscoveryContinuationCriterion = {
  key: string;
  policy: FreshnessPolicy;
  coverageUnresolved: boolean;
  hasSupportedEvidence: boolean;
  disputed?: boolean;
  boundSources: ReadonlyArray<FreshnessBoundSource>;
};

const HISTORICAL_TOKENS =
  /\b(history|historical|founding|founded|established|incorporated|outbreak|war of|treaty of|born|birth of|signed the treaty|chartered|commenced operations|commence operations)\b/i;

function policy(
  cls: FreshnessClass,
  maxAgeHours: number | null,
  requiresEffectiveDate: boolean,
  requiresVersion: boolean,
  rationale: string,
): FreshnessPolicy {
  return { version: FRESHNESS_POLICY_VERSION, class: cls, maxAgeHours, requiresEffectiveDate, requiresVersion, rationale };
}

function historicalPolicy(): FreshnessPolicy {
  return policy("historical", null, false, false, "Historical events may prefer contemporaneous authoritative evidence over later summaries.");
}

/** Recency conjuncts on classification text. Bare `employees` / `now` and `as of <date>` are not vetoes. */
export function hasRecencyVeto(text: string): boolean {
  if (/\b(current|today|latest)\b/i.test(text)) return true;
  if (/\b(price|pricing|availability)\b/i.test(text)) return true;
  if (/\bheadcount\b/i.test(text)) return true;
  if (/\bemployee count\b/i.test(text)) return true;
  if (/\bas of (now|today)\b/i.test(text)) return true;
  return false;
}

function hasHistoricalTokens(text: string): boolean {
  if (HISTORICAL_TOKENS.test(text)) return true;
  return /\bsigned\b/i.test(text) && /\btreaty\b/i.test(text);
}

/** Past-tense public facts. Current/today/price/latest/headcount questions stay on recency classes. */
export function isHistoricalFactQuestion(question: string, criterionKey?: string): boolean {
  const q = `${criterionKey ?? ""} ${question}`;
  if (/current|today|price|pricing/i.test(q)) return false;
  if (hasRecencyVeto(q)) return false;
  return hasHistoricalTokens(q);
}

function freshnessPolicyFromText(text: string): FreshnessPolicy {
  if (/current (price|pricing|cost)|price (now|today)|availability/i.test(text)) {
    return policy("price", 72, true, false, "Current price/availability needs a very recent first-party figure.");
  }
  if (/\b(law|statute|regulation|regulator|legal|jurisdiction|effective|act|cfr|usc)\b/i.test(text)) {
    return policy("law", null, true, false, "Law needs the current effective rule for the named jurisdiction, not merely a recent article.");
  }
  if (
    /compatib|supported (on|with)|current (firmware|version)|latest (firmware|version)|firmware version|which versions? (?:is|are) (?:supported|compatible)/i.test(
      text,
    )
  ) {
    return policy("compatibility", null, false, true, "Software compatibility needs the currently applicable version/release.");
  }
  if (!hasRecencyVeto(text) && hasHistoricalTokens(text)) {
    return historicalPolicy();
  }
  if (/\b(study|trial|meta-analysis|systematic review|peer[- ]reviewed)\b/i.test(text)) {
    return policy("science", null, true, false, "Scientific evidence is dated plus method/relevance, not recency alone.");
  }
  return policy("generic", 24 * 365, false, false, "Default freshness is a one-year window unless the criterion specifies otherwise.");
}

export function freshnessPolicyForQuestion(question: string, criterionKey?: string): FreshnessPolicy {
  return freshnessPolicyFromText(`${criterionKey ?? ""} ${question}`.trim());
}

function classificationText(question: string, criterion: FreshnessCriterionInput): { text: string; quoteEqualsQuestion: boolean } {
  const provenance = criterion.provenance;
  const quote = provenance?.quote ?? "";
  if (provenance && quote && provenance.start >= 0 && provenance.end > provenance.start && question.slice(provenance.start, provenance.end) === quote) {
    if (quote === question) return { text: question, quoteEqualsQuestion: true };
    return { text: quote, quoteEqualsQuestion: false };
  }
  const field = criterion.field?.trim() ?? "";
  if (field && question.includes(field)) return { text: field, quoteEqualsQuestion: false };
  const description = criterion.description?.trim() ?? "";
  if (description && description !== question && question.includes(description)) {
    return { text: description, quoteEqualsQuestion: false };
  }
  return { text: criterion.key.replace(/[_-]+/g, " ").trim(), quoteEqualsQuestion: false };
}

/**
 * Criterion-local class. Do not use freshnessPolicyForQuestion(question, key) as the mixed-task classifier:
 * concatenating the full question re-imports sibling tokens.
 */
export function freshnessPolicyForCriterion(
  question: string,
  criterion: FreshnessCriterionInput,
  siblings?: ReadonlyArray<FreshnessCriterionInput>,
): FreshnessPolicy {
  const local = classificationText(question, criterion);
  if (local.quoteEqualsQuestion) return freshnessPolicyForQuestion(question);
  const group = siblings?.length ? siblings : [criterion];
  const mixed = hasRecencyVeto(question) || group.some((c) => hasRecencyVeto(classificationText(question, c).text));
  const fromLocal = freshnessPolicyFromText(local.text);
  if (mixed) return fromLocal;
  if (!hasRecencyVeto(local.text) && freshnessPolicyForQuestion(question).class === "historical") {
    return historicalPolicy();
  }
  return fromLocal;
}

/** Exactly one hard (or only) historical criterion and no recency conjunct. Two-company and mixed are not simple. */
export function isSimpleHistoricalLookup(args: {
  question: string;
  criteria?: ReadonlyArray<FreshnessCriterionInput>;
}): boolean {
  const criteria = args.criteria ?? [];
  if (!criteria.length) return false;
  if (hasRecencyVeto(args.question) || criteria.some((c) => hasRecencyVeto(classificationText(args.question, c).text))) {
    return false;
  }
  const hard = criteria.filter((c) => (c.importance ?? "hard") === "hard");
  const considered = hard.length ? hard : criteria;
  if (considered.length !== 1) return false;
  return freshnessPolicyForCriterion(args.question, considered[0]!, criteria).class === "historical";
}

export function evaluateFreshness(policy: FreshnessPolicy, args: {
  observedAt: Date;
  sourceDate?: Date | null;
  effectiveDate?: Date | null;
  version?: string | null;
  now?: Date;
}): FreshnessEvaluation {
  const now = args.now ?? args.observedAt;
  if (policy.class === "historical") {
    if (!args.sourceDate) return "unknown";
    return args.sourceDate.getTime() <= now.getTime() ? "historical-preferred" : "unknown";
  }
  if (policy.requiresVersion && !args.version) return "unknown";
  if (policy.requiresEffectiveDate && !args.effectiveDate && policy.class === "law") return "unknown";
  if (policy.requiresVersion && args.version && !policy.requiresEffectiveDate && policy.maxAgeHours === null) {
    return "fresh";
  }
  const dated = args.effectiveDate ?? args.sourceDate;
  if (!dated) return "unknown";
  if (policy.maxAgeHours === null) {
    return dated.getTime() <= now.getTime() ? "fresh" : "stale";
  }
  const ageHours = (now.getTime() - dated.getTime()) / 3_600_000;
  if (ageHours < 0) return "unknown";
  return ageHours <= policy.maxAgeHours ? "fresh" : "stale";
}

/** ISO calendar dates only. Absence is unknown, never stale. */
export function parseSourcePublicationDate(text: string): Date | null {
  const iso = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
  if (!iso) return null;
  const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== `${iso[1]}-${iso[2]}-${iso[3]}` ? null : d;
}

export function unresolvedFreshnessLimitation(policy: FreshnessPolicy): string {
  if (policy.requiresVersion) return "Required applicable version remains unknown.";
  if (policy.class === "law") return "Required effective legal date remains unknown.";
  if (policy.requiresEffectiveDate) return "Required source date remains unknown.";
  return "Required source freshness remains unknown.";
}

export function sourcesHaveUnmetFreshness(
  policy: FreshnessPolicy,
  sources: ReadonlyArray<FreshnessBoundSource>,
  now?: Date,
): boolean {
  // Undated or decade-old official pages are not a reason to keep searching a past-tense fact.
  if (policy.class === "historical") return false;
  const observedAt = now ?? new Date();
  const required = policy.requiresEffectiveDate || policy.requiresVersion;
  if (!sources.length) return required;
  return sources.some((s) => {
    const status = evaluateFreshness(policy, { observedAt: s.retrievedAt ?? observedAt, sourceDate: s.publicationDate, effectiveDate: s.effectiveDate, version: s.version, now: observedAt });
    return status === "stale" || (required && status === "unknown");
  });
}

/** Bound-source freshness. Empty non-historical sets are unmet. Do not score run-wide sources under a sibling class. */
export function criterionBoundFreshnessUnmet(
  policy: FreshnessPolicy,
  boundSources: ReadonlyArray<FreshnessBoundSource>,
  now?: Date,
): boolean {
  if (policy.class === "historical") return false;
  if (!boundSources.length) return true;
  const observedAt = now ?? new Date();
  const required = policy.requiresEffectiveDate || policy.requiresVersion;
  return boundSources.some((s) => {
    const status = evaluateFreshness(policy, {
      observedAt: s.retrievedAt ?? observedAt,
      sourceDate: s.publicationDate,
      effectiveDate: s.effectiveDate,
      version: s.version,
      now: observedAt,
    });
    return status === "stale" || (required && status === "unknown");
  });
}

const normalizeScope = (s: string) => s.toLowerCase().replace(/\s+/gu, " ").trim();

/**
 * Assertion ⋈ support join for one criterion. Disputed/contradicted and scope mismatch are not supported.
 */
export function hasSupportedEvidenceForCriterion(args: {
  criterionKey: string;
  criterionScope?: Record<string, string | null> | null;
  assertions: ReadonlyArray<{
    key: string;
    criterionKeys: readonly string[];
    scope?: Record<string, string | null> | null;
  }>;
  checks: ReadonlyArray<{ claimKey: string; decision: string }>;
}): boolean {
  const relevant = args.assertions.filter((a) => a.criterionKeys.includes(args.criterionKey));
  if (!relevant.length) return false;
  const scope = args.criterionScope ?? {};
  const scoped = relevant.filter((a) =>
    Object.entries(scope).every(([field, value]) => {
      if (value == null) return true;
      return normalizeScope(String(value)) === normalizeScope(String(a.scope?.[field] ?? ""));
    }),
  );
  if (!scoped.length) return false;
  for (const assertion of scoped) {
    const rows = args.checks.filter((c) => c.claimKey === assertion.key);
    if (rows.some((c) => c.decision === "disputed" || c.decision === "contradicted")) continue;
    if (rows.some((c) => c.decision === "supported")) return true;
  }
  return false;
}

/**
 * Per-criterion continuation. Coverage one-year noise does not keep a supported historical key open.
 * A supported sibling does not clear remaining keys. Do not wipe all keys because any check is supported.
 */
export function discoveryContinuationGaps(args: {
  criteria: ReadonlyArray<DiscoveryContinuationCriterion>;
  now?: Date;
}): {
  unresolvedCriterionKeys: string[];
  freshnessUnmetByKey: Record<string, boolean>;
  freshnessUnmet: boolean;
} {
  const freshnessUnmetByKey: Record<string, boolean> = {};
  const unresolvedCriterionKeys: string[] = [];
  for (const criterion of args.criteria) {
    const freshnessUnmet = criterionBoundFreshnessUnmet(criterion.policy, criterion.boundSources, args.now);
    freshnessUnmetByKey[criterion.key] = freshnessUnmet;
    const supported = criterion.hasSupportedEvidence && !criterion.disputed;
    const sufficient =
      supported &&
      !freshnessUnmet &&
      !(criterion.coverageUnresolved && criterion.policy.class !== "historical") &&
      !(criterion.coverageUnresolved && criterion.policy.class === "historical" && !supported);
    if (!sufficient) unresolvedCriterionKeys.push(criterion.key);
  }
  const freshnessUnmet = args.criteria.some((c) => c.policy.class !== "historical" && freshnessUnmetByKey[c.key]);
  return { unresolvedCriterionKeys, freshnessUnmetByKey, freshnessUnmet };
}
