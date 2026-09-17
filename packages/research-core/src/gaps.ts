import type { ControllerState, Gap, GapAttempt } from "./types.js";

const SUMMARY_TYPES = new Set(["review-summary", "blog", "wire"]);
const PRIMARY_TYPES = new Set(["vendor-matrix", "vendor-docs", "primary-docs", "catalog"]);

function attemptsFor(state: ControllerState, _gapId: string, sourceType: string): GapAttempt[] {
  const related = state.searches.filter(
    (s) => (s.query ?? "").includes(sourceType) || (s.query ?? "").includes("compatibility matrix") || (s.query ?? "").includes("pediatric"),
  );
  return related.map((s, i) => ({
    actionType: "search",
    query: s.query,
    outcome: s.coverageProgress || s.newFamilies > 0 ? "new_families" : "no_progress",
    atEvidenceRevision: i + 1,
  }));
}

export function detectGaps(state: ControllerState): Gap[] {
  const gaps: Gap[] = [...state.gaps];
  const q = state.brief.originalQuestion.toLowerCase();
  const types = new Set(state.sources.map((s) => s.sourceType ?? "web"));

  if (/compatib|eligible|works with|support postgres/i.test(q)) {
    const hasPrimary = state.sources.some((s) => PRIMARY_TYPES.has(s.sourceType ?? ""));
    const onlySummaries =
      state.sources.length > 0 && state.sources.every((s) => SUMMARY_TYPES.has(s.sourceType ?? "review-summary"));
    const pivoted = state.searches.some((s) => /compatibility matrix|vendor-matrix/i.test(s.query ?? ""));
    if (!gaps.some((g) => g.id === "compat-primary")) {
      const attempts = attemptsFor(state, "compat-primary", "vendor-matrix");
      if (hasPrimary && pivoted) {
        gaps.push({
          id: "compat-primary",
          missingFact: "authoritative compatibility limitation",
          whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
          dependentConclusion: "eligibility of named products under the stated stack",
          resolvingEvidence: "vendor compatibility matrix or official support matrix for the named versions",
          importance: "material",
          sourceTypeNeeded: "vendor-matrix",
          suggestedQuery: `${state.brief.originalQuestion} vendor compatibility matrix`,
          attempts,
          latestOutcome: "resolved",
          remainingUncertainty: "Primary matrix inspected; remaining uncertainty is localized to unstated versions.",
        });
      } else if (!hasPrimary && (onlySummaries || state.sources.length === 0 || types.has("review-summary"))) {
        gaps.push({
          id: "compat-primary",
          missingFact: "authoritative compatibility limitation",
          whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
          dependentConclusion: "eligibility of named products under the stated stack",
          resolvingEvidence: "vendor compatibility matrix or official support matrix for the named versions",
          importance: "blocking",
          sourceTypeNeeded: "vendor-matrix",
          suggestedQuery: `${state.brief.originalQuestion} vendor compatibility matrix`,
          attempts,
          latestOutcome: attempts.length ? attempts[attempts.length - 1]!.outcome : "untried",
          remainingUncertainty: "Compatibility remains unverified until a primary matrix is inspected.",
        });
      }
    }
  }

  const pop = state.constraints.find((c) => c.field === "population");
  if (pop && /child|pediatric|under/i.test(pop.value)) {
    const pediatric = state.sources.some((s) => /child|pediatric/i.test(s.population ?? ""));
    if (!pediatric && !gaps.some((g) => g.id === "population")) {
      const attempts = attemptsFor(state, "population", "population-specific");
      gaps.push({
        id: "population",
        missingFact: "population-specific evidence",
        whyItCouldChangeAnswer: "Adult figures may not apply",
        dependentConclusion: "numeric claims applied to the stated population",
        resolvingEvidence: "a source that reports the same measure for the named population",
        importance: "blocking",
        sourceTypeNeeded: "population-specific",
        suggestedQuery: `${state.brief.originalQuestion} pediatric children population`,
        attempts,
        latestOutcome: (attempts ?? [])[Math.max((attempts ?? []).length - 1, 0)]?.outcome ?? "untried",
        remainingUncertainty: "Adult-only figures cannot be generalized to the stated population.",
      });
    }
  }

  return gaps;
}

export function triedSourceType(state: ControllerState, sourceType: string): boolean {
  return state.sources.some((s) => s.sourceType === sourceType) ||
    state.searches.some((s) => (s.query ?? "").includes(sourceType) || (s.query ?? "").includes("compatibility matrix"));
}
