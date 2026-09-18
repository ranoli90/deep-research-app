export const FRESHNESS_POLICY_VERSION = "criterion-freshness.v1";
export const FRESHNESS_CLASSES = ["price", "law", "compatibility", "historical", "science", "generic"] as const;
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];
export type FreshnessPolicy = {
  version: typeof FRESHNESS_POLICY_VERSION;
  class: FreshnessClass;
  maxAgeHours: number | null;
  requiresEffectiveDate: boolean;
  requiresVersion: boolean;
  rationale: string;
};
export type FreshnessEvaluation = "fresh" | "stale" | "historical-preferred" | "unknown";

export function freshnessPolicyForQuestion(question: string, criterionKey?: string): FreshnessPolicy {
  const q = `${criterionKey ?? ""} ${question}`;
  if (/current (price|pricing|cost)|price (now|today)|availability/i.test(q)) {
    return {
      version: FRESHNESS_POLICY_VERSION,
      class: "price",
      maxAgeHours: 72,
      requiresEffectiveDate: true,
      requiresVersion: false,
      rationale: "Current price/availability needs a very recent first-party figure.",
    };
  }
  if (/\b(law|statute|regulation|regulator|legal|jurisdiction|effective|act|cfr|usc)\b/i.test(q)) {
    return {
      version: FRESHNESS_POLICY_VERSION,
      class: "law",
      maxAgeHours: null,
      requiresEffectiveDate: true,
      requiresVersion: false,
      rationale: "Law needs the current effective rule for the named jurisdiction, not merely a recent article.",
    };
  }
  if (/compatib|supported (on|with)|firmware|version/i.test(q)) {
    return {
      version: FRESHNESS_POLICY_VERSION,
      class: "compatibility",
      maxAgeHours: null,
      requiresEffectiveDate: false,
      requiresVersion: true,
      rationale: "Software compatibility needs the currently applicable version/release.",
    };
  }
  if (/\b(history|historical|founding|outbreak|war of|treaty of)\b/i.test(q) && !/current|today|price|pricing/i.test(q)) {
    return {
      version: FRESHNESS_POLICY_VERSION,
      class: "historical",
      maxAgeHours: null,
      requiresEffectiveDate: false,
      requiresVersion: false,
      rationale: "Historical events may prefer contemporaneous authoritative evidence over later summaries.",
    };
  }
  if (/\b(study|trial|meta-analysis|systematic review|peer[- ]reviewed)\b/i.test(q)) {
    return {
      version: FRESHNESS_POLICY_VERSION,
      class: "science",
      maxAgeHours: null,
      requiresEffectiveDate: true,
      requiresVersion: false,
      rationale: "Scientific evidence is dated plus method/relevance, not recency alone.",
    };
  }
  return {
    version: FRESHNESS_POLICY_VERSION,
    class: "generic",
    maxAgeHours: 24 * 365,
    requiresEffectiveDate: false,
    requiresVersion: false,
    rationale: "Default freshness is a one-year window unless the criterion specifies otherwise.",
  };
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
  const dated = args.effectiveDate ?? args.sourceDate;
  if (!dated) return "unknown";
  if (policy.maxAgeHours === null) {
    return dated.getTime() <= now.getTime() ? "fresh" : "stale";
  }
  const ageHours = (now.getTime() - dated.getTime()) / 3_600_000;
  if (ageHours < 0) return "unknown";
  return ageHours <= policy.maxAgeHours ? "fresh" : "stale";
}
