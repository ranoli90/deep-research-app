import { criterionObligationIsAtomic, type QuestionObligationInput } from "./semantic-obligations.js";

export const FRESHNESS_POLICY_VERSIONS = ["criterion-freshness.v2", "criterion-freshness.v3", "criterion-freshness.v4"] as const;
export type FreshnessPolicyVersion = (typeof FRESHNESS_POLICY_VERSIONS)[number];
/** New writes. Readers must retain the meaning of every accepted stored version. */
export const FRESHNESS_POLICY_VERSION: FreshnessPolicyVersion = "criterion-freshness.v4";
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
  operator?: string | null;
  groupOperator?: string | null;
  unresolvedAlternatives?: ReadonlyArray<string> | null;
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
  /** Only the worker's structural task check may authorize ignoring a coverage-model freshness nag. */
  historicalCoverageOverrideAllowed?: boolean;
};

const HISTORICAL_TOKENS =
  /\b(history|historical|founding|founded|established|incorporated|outbreak|war of|treaty of|born|birth of|signed the treaty|chartered|commenced operations|commence operations)\b/i;

function policy(
  version: FreshnessPolicyVersion,
  cls: FreshnessClass,
  maxAgeHours: number | null,
  requiresEffectiveDate: boolean,
  requiresVersion: boolean,
  rationale: string,
): FreshnessPolicy {
  return { version, class: cls, maxAgeHours, requiresEffectiveDate, requiresVersion, rationale };
}

function historicalPolicy(version: FreshnessPolicyVersion): FreshnessPolicy {
  return policy(version, "historical", null, false, false, "Historical events may prefer contemporaneous authoritative evidence over later summaries.");
}

const FIXED_TIME_ANCHOR = /\b(?:(?:as of|in|during|on)\s+(?:(?:(?:fiscal|fy)\s*)?(?:q[1-4]\s*)?(?:19|20)\d{2}(?:-\d{2}-\d{2})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(?:19|20)\d{2})|(?:fiscal|fy)\s*(?:19|20)\d{2}|q[1-4]\s*(?:of\s*)?(?:19|20)\d{2}|(?:at|by)\s+(?:the\s+)?(?:start|beginning|end|close)\s+of\s+(?:(?:fiscal|calendar)\s+)?(?:19|20)\d{2}|(?:first|second|third|fourth)\s+quarter(?:\s+of)?\s+(?:19|20)\d{2})\b/iu;
const FISCAL_PERIOD_ANCHOR = /\b(?:(?:(?:in|during|for)\s+(?:the\s+)?)?(?:fiscal\s+year|fy)\s+(?:(?:ended|ending)(?:\s+on)?\s+)?(?:(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+)?(?:19|20)\d{2}|(?:at|by)\s+(?:the\s+)?(?:start|beginning|end|close)\s+of\s+(?:the\s+)?(?:fiscal\s+year|fy)\s+(?:19|20)\d{2}|(?:at|by)\s+(?:the\s+)?fiscal\s+year[- ]end\s+(?:19|20)\d{2})\b/iu;
const WORKFORCE_TERM = /\b(?:employees?|staff|headcount|workforce|workers?|team size)\b/iu;
const PRESENT_WORKFORCE_SHAPE = /\b(?:how many|number of|what (?:is|are)|state|report|provide|give|list|tell|does|do|is|are|has|have|employs?|work(?:s|ing)?)\b/iu;
const hasFixedTimeAnchor = (text: string) => FIXED_TIME_ANCHOR.test(text) || FISCAL_PERIOD_ANCHOR.test(text);

function hasRecencyVetoForVersion(text: string, version: FreshnessPolicyVersion): boolean {
  if (/\b(current|today|latest)\b/iu.test(text)) return true;
  if (version === "criterion-freshness.v4" && /\b(?:live|now|currently|at present|right now)\b/iu.test(text)) return true;
  if (version === "criterion-freshness.v4" && hasFixedTimeAnchor(text)) return false;
  if (/\b(price|pricing|availability)\b/i.test(text)) return true;
  if (/\bheadcount\b/i.test(text)) return true;
  if (/\bemployee count\b/i.test(text)) return true;
  if (/\bas of (now|today)\b/i.test(text)) return true;
  if (version === "criterion-freshness.v4") {
    if (!hasFixedTimeAnchor(text) && WORKFORCE_TERM.test(text) && PRESENT_WORKFORCE_SHAPE.test(text)) return true;
  }
  return false;
}

/** Recency conjuncts for new policy writes. Stored v2/v3 rows retain their prior classification. */
export function hasRecencyVeto(text: string): boolean {
  return hasRecencyVetoForVersion(text, FRESHNESS_POLICY_VERSION);
}

function hasHistoricalTokens(text: string): boolean {
  if (HISTORICAL_TOKENS.test(text)) return true;
  return /\bsigned\b/i.test(text) && /\btreaty\b/i.test(text);
}

/** Past-tense public facts. Current/today/price/latest/headcount questions stay on recency classes. */
export function isHistoricalFactQuestion(
  question: string,
  criterionKey?: string,
  version: FreshnessPolicyVersion = FRESHNESS_POLICY_VERSION,
): boolean {
  const q = `${criterionKey ?? ""} ${question}`;
  if (/current|today|price|pricing/i.test(q)) return false;
  if (hasRecencyVetoForVersion(q, version)) return false;
  if (version === "criterion-freshness.v4" && hasFixedTimeAnchor(q)) return true;
  return hasHistoricalTokens(q);
}

function freshnessPolicyFromText(text: string, version: FreshnessPolicyVersion): FreshnessPolicy {
  if (/current (price|pricing|cost)|price (now|today)|availability/i.test(text)) {
    return policy(version, "price", 72, true, false, "Current price/availability needs a very recent first-party figure.");
  }
  if (/\b(law|statute|regulation|regulator|legal|jurisdiction|effective|act|cfr|usc)\b/i.test(text)) {
    return policy(version, "law", null, true, false, "Law needs the current effective rule for the named jurisdiction, not merely a recent article.");
  }
  if (
    /compatib|supported (on|with)|current (firmware|version)|latest (firmware|version)|firmware version|which versions? (?:is|are) (?:supported|compatible)/i.test(
      text,
    )
  ) {
    return policy(version, "compatibility", null, false, true, "Software compatibility needs the currently applicable version/release.");
  }
  if (!hasRecencyVetoForVersion(text, version) && (hasHistoricalTokens(text) || (version === "criterion-freshness.v4" && hasFixedTimeAnchor(text)))) {
    return historicalPolicy(version);
  }
  if (/\b(study|trial|meta-analysis|systematic review|peer[- ]reviewed)\b/i.test(text)) {
    return policy(version, "science", null, true, false, "Scientific evidence is dated plus method/relevance, not recency alone.");
  }
  return policy(version, "generic", 24 * 365, false, false, "Default freshness is a one-year window unless the criterion specifies otherwise.");
}

export function freshnessPolicyForQuestion(
  question: string,
  criterionKey?: string,
  version: FreshnessPolicyVersion = FRESHNESS_POLICY_VERSION,
): FreshnessPolicy {
  return freshnessPolicyFromText(`${criterionKey ?? ""} ${question}`.trim(), version);
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
  version: FreshnessPolicyVersion = FRESHNESS_POLICY_VERSION,
): FreshnessPolicy {
  const local = classificationText(question, criterion);
  if (local.quoteEqualsQuestion) return freshnessPolicyForQuestion(question, undefined, version);
  const group = siblings?.length ? siblings : [criterion];
  const mixed = hasRecencyVetoForVersion(question, version) || group.some((c) => hasRecencyVetoForVersion(classificationText(question, c).text, version));
  const fromLocal = freshnessPolicyFromText(local.text, version);
  if (mixed) return fromLocal;
  if (!hasRecencyVetoForVersion(local.text, version) && freshnessPolicyForQuestion(question, undefined, version).class === "historical") {
    return historicalPolicy(version);
  }
  return fromLocal;
}

function structurallyAtomicQuestion(
  question: string,
  criterion: FreshnessCriterionInput,
  questions?: ReadonlyArray<QuestionObligationInput>,
): boolean {
  const provenance = criterion.provenance;
  if (provenance && question.slice(provenance.start, provenance.end) !== provenance.quote) return false;
  return criterionObligationIsAtomic({ originalQuestion: question, criterion, questions });
}

/** Exactly one structurally atomic historical criterion and no current fact may use the bounded shortcut. */
export function isSimpleHistoricalLookup(args: {
  question: string;
  criteria?: ReadonlyArray<FreshnessCriterionInput>;
  questions?: ReadonlyArray<QuestionObligationInput>;
  policyVersion?: FreshnessPolicyVersion;
  restoredPolicy?: FreshnessPolicy;
}): boolean {
  const criteria = args.criteria ?? [];
  const version = args.restoredPolicy?.version ?? args.policyVersion ?? FRESHNESS_POLICY_VERSION;
  if (!criteria.length) return false;
  if (hasRecencyVetoForVersion(args.question, version) || criteria.some((c) => hasRecencyVetoForVersion(classificationText(args.question, c).text, version))) {
    return false;
  }
  const hard = criteria.filter((c) => (c.importance ?? "hard") === "hard");
  const considered = hard.length ? hard : criteria;
  if (considered.length !== 1) return false;
  return structurallyAtomicQuestion(args.question, considered[0]!, args.questions)
    && (args.restoredPolicy?.class ?? freshnessPolicyForCriterion(args.question, considered[0]!, criteria, version).class) === "historical";
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
 * Per-criterion continuation. Only a structurally proven atomic historical lookup may ignore coverage noise.
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
      !(criterion.coverageUnresolved && criterion.policy.class === "historical" && !criterion.historicalCoverageOverrideAllowed);
    if (!sufficient) unresolvedCriterionKeys.push(criterion.key);
  }
  const freshnessUnmet = args.criteria.some((c) => c.policy.class !== "historical" && freshnessUnmetByKey[c.key]);
  return { unresolvedCriterionKeys, freshnessUnmetByKey, freshnessUnmet };
}
