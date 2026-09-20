export const SOURCE_STRATEGY_VERSION = "source-type-plan.v1";
export const SOURCE_CLASSES = [
  "first-party-pricing",
  "vendor-docs",
  "release-notes",
  "repository-tests",
  "statute-regulator",
  "primary-literature",
  "systematic-review",
  "filings",
  "investor-materials",
  "docs-source-issues-benchmarks",
  "independent-review",
  "community",
  "generic-web",
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export type SourcePlan = {
  version: typeof SOURCE_STRATEGY_VERSION;
  primary: SourceClass;
  fallbacks: SourceClass[];
  rationale: string;
};

const RULES: { test: RegExp; primary: SourceClass; fallbacks: SourceClass[]; rationale: string }[] = [
  {
    test: /\b(official|federal minimum wage|minimum wage|dol\.gov|irs\.gov|fomc|usc|cfr)\b/i,
    primary: "statute-regulator",
    fallbacks: ["generic-web", "filings"],
    rationale: "Official legal or wage facts require regulator or statute pages, then other public sources if those pages are blocked.",
  },
  {
    test: /current (price|pricing|cost)|list price|msrp|how much (does|is)|price (now|today)/i,
    primary: "first-party-pricing",
    fallbacks: ["vendor-docs", "filings"],
    rationale: "Current pricing is established by first-party price pages, not syndicated blogs.",
  },
  {
    test: /compatib|works with|supported (on|with)|interop|release notes/i,
    primary: "vendor-docs",
    fallbacks: ["release-notes", "repository-tests"],
    rationale: "Compatibility is established by vendor docs, release notes, or repository tests.",
  },
  {
    test: /\b(law|statute|regulation|regulator|legal|court|jurisdiction|cfr|usc)\b/i,
    primary: "statute-regulator",
    fallbacks: ["vendor-docs"],
    rationale: "Legal claims require the current statute, regulator, or official guidance.",
  },
  {
    test: /\b(study|trial|meta-analysis|systematic review|peer[- ]reviewed|pubmed|doi)\b/i,
    primary: "primary-literature",
    fallbacks: ["systematic-review"],
    rationale: "Scientific claims require primary literature or systematic reviews.",
  },
  {
    test: /\b(funding|raised|series [a-d]|revenue|10-k|10-q|s-1|sec filing|investor)\b/i,
    primary: "filings",
    fallbacks: ["investor-materials"],
    rationale: "Funding and financial claims require filings or company/investor materials.",
  },
  {
    test: /\b(benchmark|throughput|latency|source code|github|repository issue|unit test)\b/i,
    primary: "docs-source-issues-benchmarks",
    fallbacks: ["vendor-docs", "repository-tests"],
    rationale: "Technical behavior is established by docs, source, issues, or benchmarks.",
  },
  {
    test: /\b(review|customer|experience|complaint|reddit|forum|worth (it|buying))\b/i,
    primary: "independent-review",
    fallbacks: ["community", "vendor-docs"],
    rationale: "Customer experience uses independent review or community evidence, not only vendor copy.",
  },
];

export function planSourceClass(question: string): SourcePlan {
  for (const rule of RULES) {
    if (rule.test.test(question)) {
      return { version: SOURCE_STRATEGY_VERSION, primary: rule.primary, fallbacks: rule.fallbacks, rationale: rule.rationale };
    }
  }
  return {
    version: SOURCE_STRATEGY_VERSION,
    primary: "generic-web",
    fallbacks: ["vendor-docs", "independent-review"],
    rationale: "No specialized source class matched; keep generic web as a bounded starting class.",
  };
}

const UNOFFICIAL_CLASSES = new Set<SourceClass>(["generic-web", "community", "independent-review"]);

/** "Only official sources" must not pivot into blogs or community pages. */
export function constrainSourcePlan(plan: SourcePlan, mode: string | undefined): SourcePlan {
  if (mode !== "primary_only" && mode !== "allowed_domains" && mode !== "trusted_domains") return plan;
  return { ...plan, fallbacks: plan.fallbacks.filter((c) => !UNOFFICIAL_CLASSES.has(c)) };
}

export function nextSourceClass(plan: SourcePlan, attempted: readonly string[], evidence: {
  weak: boolean;
  duplicative: boolean;
  stale: boolean;
}): SourceClass {
  if (!evidence.weak && !evidence.duplicative && !evidence.stale) return plan.primary;
  const order = [plan.primary, ...plan.fallbacks];
  if (!attempted.length) return plan.fallbacks[0] ?? plan.primary;
  const unused = order.find((c) => !attempted.includes(c));
  return unused ?? order[order.length - 1]!;
}

export function sourceClassAttempted(query: string, sourceClass: SourceClass): boolean {
  const needle = sourceClass.replace(/-/g, " ");
  return query.toLowerCase().includes(needle) || query.toLowerCase().includes(sourceClass);
}
