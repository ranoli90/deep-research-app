export const FRESHNESS_POLICY_VERSION = "criterion-freshness.v2";
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
  sources: ReadonlyArray<{ publicationDate?: Date | null; effectiveDate?: Date | null; version?: string | null; retrievedAt?: Date | null }>,
  now?: Date,
): boolean {
  const observedAt = now ?? new Date();
  const required = policy.requiresEffectiveDate || policy.requiresVersion;
  if (!sources.length) return required;
  return sources.some((s) => {
    const status = evaluateFreshness(policy, { observedAt: s.retrievedAt ?? observedAt, sourceDate: s.publicationDate, effectiveDate: s.effectiveDate, version: s.version, now: observedAt });
    return status === "stale" || (required && status === "unknown");
  });
}
