import type { ControllerState, Gap } from "./types.js";

const SUMMARY_TYPES = new Set(["review-summary", "blog", "wire"]);
const PRIMARY_TYPES = new Set(["vendor-matrix", "vendor-docs", "primary-docs", "catalog"]);

export function detectGaps(state: ControllerState): Gap[] {
  const gaps: Gap[] = [...state.gaps];
  const q = state.brief.originalQuestion.toLowerCase();
  const types = new Set(state.sources.map((s) => s.sourceType ?? "web"));

  if (/compatib|eligible|works with|support postgres/i.test(q)) {
    const hasPrimary = state.sources.some((s) => PRIMARY_TYPES.has(s.sourceType ?? ""));
    const onlySummaries =
      state.sources.length > 0 && state.sources.every((s) => SUMMARY_TYPES.has(s.sourceType ?? "review-summary"));
    if (!hasPrimary && (onlySummaries || state.sources.length === 0 || types.has("review-summary"))) {
      if (!gaps.some((g) => g.id === "compat-primary")) {
        gaps.push({
          id: "compat-primary",
          missingFact: "authoritative compatibility limitation",
          whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
          importance: "blocking",
          sourceTypeNeeded: "vendor-matrix",
          suggestedQuery: `${state.brief.originalQuestion} vendor compatibility matrix`,
        });
      }
    }
  }

  const pop = state.constraints.find((c) => c.field === "population");
  if (pop && /child|pediatric|under/i.test(pop.value)) {
    const pediatric = state.sources.some((s) => /child|pediatric/i.test(s.population ?? ""));
    if (!pediatric && !gaps.some((g) => g.id === "population")) {
      gaps.push({
        id: "population",
        missingFact: "population-specific evidence",
        whyItCouldChangeAnswer: "Adult figures may not apply",
        importance: "blocking",
        sourceTypeNeeded: "population-specific",
        suggestedQuery: `${state.brief.originalQuestion} pediatric children population`,
      });
    }
  }

  return gaps;
}

export function triedSourceType(state: ControllerState, sourceType: string): boolean {
  return state.sources.some((s) => s.sourceType === sourceType) ||
    state.searches.some((s) => (s.query ?? "").includes(sourceType) || (s.query ?? "").includes("compatibility matrix"));
}
