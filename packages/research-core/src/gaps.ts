import { detectContradictions } from "./contradictions.js";
import { PRIMARY_SOURCE_TYPES, WEAK_SOURCE_TYPES, isWeakSourceClass } from "./independence.js";
import type { ControllerState, Gap, GapAttempt } from "./types.js";

function attemptsFor(state: ControllerState, sourceType: string): GapAttempt[] {
  const related = state.searches.filter(
    (s) =>
      (s.query ?? "").includes(sourceType) ||
      (s.query ?? "").includes("compatibility matrix") ||
      (s.query ?? "").includes("pediatric") ||
      (s.query ?? "").includes("official") ||
      (s.query ?? "").includes("counterexample"),
  );
  return related.map((s, i) => ({
    actionType: "search",
    query: s.query,
    outcome: s.coverageProgress || s.newFamilies > 0 ? "new_families" : "no_progress",
    atEvidenceRevision: i + 1,
  }));
}

export function needsPrimaryEvidence(question: string): boolean {
  return /compatib|eligible|works with|support postgres|official|primary source|legal|regulator|current price|filing|tax deadline|catalog lookup/i.test(
    question,
  );
}

function opened(state: ControllerState, sourceId: string): boolean {
  const s = state.sources.find((x) => x.id === sourceId);
  if (!s) return false;
  return s.accessLevel === "full-text" || s.accessLevel === "partial-text" || s.accessLevel === "abstract";
}

export function detectGaps(state: ControllerState): Gap[] {
  if (state.ablations?.disableGapDetection) return [...state.gaps];
  const gaps: Gap[] = [...state.gaps];
  const q = state.brief.originalQuestion.toLowerCase();
  const types = new Set(state.sources.map((s) => s.sourceType ?? "web"));

  if (needsPrimaryEvidence(q) || /compatib|eligible|works with|support postgres/i.test(q)) {
    const hasPrimary = state.sources.some((s) => PRIMARY_SOURCE_TYPES.has(s.sourceType ?? ""));
    const onlySummaries =
      state.sources.length > 0 &&
      state.sources.every(
        (s) => WEAK_SOURCE_TYPES.has(s.sourceType ?? "review-summary") || isWeakSourceClass(s),
      );
    if (!gaps.some((g) => g.id === "compat-primary")) {
      const attempts = attemptsFor(state, "vendor-matrix");
      const pivoted = state.searches.some((s) => /compatibility matrix|vendor-matrix/i.test(s.query ?? "")) || Boolean(state.lastPivotReason);
      if (hasPrimary && (pivoted || attempts.length > 0)) {
        gaps.push({
          id: "compat-primary",
          missingFact: "authoritative compatibility limitation",
          description: "authoritative compatibility limitation",
          whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
          dependentConclusion: "eligibility of named products under the stated stack",
          resolvingEvidence: "vendor compatibility matrix or official support matrix for the named versions",
          importance: "material",
          sourceTypeNeeded: "vendor-matrix",
          preferredSourceTypes: ["vendor-matrix", "vendor-docs", "primary-docs"],
          suggestedQuery: `${state.brief.originalQuestion} vendor compatibility matrix`,
          attempts,
          latestOutcome: "resolved",
          remainingUncertainty: "Primary matrix inspected; remaining uncertainty is localized to unstated versions.",
          questionId: "q-compatibility",
          resolution: "resolved",
        });
      } else if (!hasPrimary && (onlySummaries || types.has("review-summary"))) {
        gaps.push({
          id: "compat-primary",
          missingFact: "authoritative compatibility limitation",
          description: "authoritative compatibility limitation",
          whyItCouldChangeAnswer: "Summary count cannot certify compatibility",
          dependentConclusion: "eligibility of named products under the stated stack",
          resolvingEvidence: "vendor compatibility matrix or official support matrix for the named versions",
          importance: "blocking",
          sourceTypeNeeded: "vendor-matrix",
          preferredSourceTypes: ["vendor-matrix", "vendor-docs", "primary-docs"],
          suggestedQuery: `${state.brief.originalQuestion} vendor compatibility matrix`,
          attempts,
          latestOutcome: attempts.length ? attempts[attempts.length - 1]!.outcome : "untried",
          remainingUncertainty: "Compatibility remains unverified until a primary matrix is inspected.",
          questionId: "q-compatibility",
          resolution: "open",
        });
      }
    }
  }

  const pop = state.constraints.find((c) => c.field === "population");
  if (pop && /child|pediatric|under/i.test(pop.value)) {
    const pediatric = state.sources.some((s) => /child|pediatric/i.test(s.population ?? ""));
    if (!pediatric && !gaps.some((g) => g.id === "population")) {
      const attempts = attemptsFor(state, "population-specific");
      gaps.push({
        id: "population",
        missingFact: "population-specific evidence",
        description: "population-specific evidence",
        whyItCouldChangeAnswer: "Adult figures may not apply",
        dependentConclusion: "numeric claims applied to the stated population",
        resolvingEvidence: "a source that reports the same measure for the named population",
        importance: "blocking",
        sourceTypeNeeded: "population-specific",
        preferredSourceTypes: ["population-specific", "primary-docs"],
        suggestedQuery: `${state.brief.originalQuestion} pediatric children population`,
        attempts,
        latestOutcome: (attempts ?? [])[Math.max((attempts ?? []).length - 1, 0)]?.outcome ?? "untried",
        remainingUncertainty: "Adult-only figures cannot be generalized to the stated population.",
        questionId: "q-population",
        resolution: "open",
      });
    }
  }

  const geo = state.constraints.find((c) => c.field === "geography" && c.importance === "hard");
  const openedSources = state.sources.filter(
    (s) => s.accessLevel === "full-text" || s.accessLevel === "partial-text" || s.accessLevel === "abstract",
  );
  if (geo && openedSources.length > 0) {
    const geoVal = String(geo.value).toLowerCase();
    const mentioned =
      state.passages.some((p) => p.exactText.toLowerCase().includes(geoVal)) ||
      openedSources.some((s) => (s.locator + s.title).toLowerCase().includes(geoVal)) ||
      state.searches.some((s) => (s.query ?? "").toLowerCase().includes(geoVal));
    if (!mentioned && !gaps.some((g) => g.id === "geo-unverified")) {
      gaps.push({
        id: "geo-unverified",
        missingFact: `hard geographic constraint (${geo.value}) has not been verified`,
        description: `hard geographic constraint (${geo.value}) has not been verified`,
        whyItCouldChangeAnswer: "Eligibility and legal answers can change by jurisdiction",
        dependentConclusion: "any geography-sensitive conclusion",
        resolvingEvidence: `a source that is scoped to ${geo.value}`,
        importance: "blocking",
        sourceTypeNeeded: "primary-docs",
        preferredSourceTypes: ["primary-docs", "regulator"],
        suggestedQuery: `${state.brief.originalQuestion} ${geo.value}`,
        remainingUncertainty: "Geography remains an unverified hard constraint.",
        resolution: "open",
      });
    }
  }

  const blockedPrimary = state.sources.filter(
    (s) => PRIMARY_SOURCE_TYPES.has(s.sourceType ?? "") && (s.accessLevel === "blocked" || s.accessLevel === "failed"),
  );
  if (blockedPrimary.length && !gaps.some((g) => g.id === "primary-inaccessible")) {
    gaps.push({
      id: "primary-inaccessible",
      missingFact: "primary source is inaccessible",
      description: "primary source is inaccessible",
      whyItCouldChangeAnswer: "The decisive document could not be opened",
      dependentConclusion: "claims that required that primary source",
      resolvingEvidence: "an accessible official copy or an explicit access-limit disclosure",
      importance: "blocking",
      sourceTypeNeeded: "primary-docs",
      latestOutcome: "inaccessible",
      remainingUncertainty: "Primary evidence remains inaccessible; conclusions stay qualified.",
      resolution: "unresolvable",
    });
  }

  const wantsCurrent = /current price|price now|today'?s price|as of now/i.test(q);
  if (wantsCurrent) {
    const dated = state.passages.map((p) => p.exactText.match(/as of\s+(20\d{2}-\d{2}-\d{2}|20\d{2})/i)?.[1]).filter(Boolean);
    if (dated.length && !gaps.some((g) => g.id === "stale-price")) {
      gaps.push({
        id: "stale-price",
        missingFact: "current official pricing",
        description: "current official pricing",
        whyItCouldChangeAnswer: "Historical list prices are not live quotes",
        dependentConclusion: "any 'current price' figure",
        resolvingEvidence: "a first-party price with an as-of date inside the freshness window, or an explicit historical caveat",
        importance: "material",
        sourceTypeNeeded: "vendor-docs",
        preferredSourceTypes: ["vendor-docs", "primary-docs"],
        suggestedQuery: `${state.brief.originalQuestion} current official pricing`,
        remainingUncertainty: `Retrieved price is dated ${dated[0]} and is not the current price.`,
        resolution: "open",
      });
    }
  }

  const verifyDone = (state.completedActionTypes ?? []).includes("verify");
  const contradictions = state.contradictions ?? detectContradictions(state);
  for (const c of contradictions.filter((x) => x.resolutionStatus === "unresolved")) {
    if (verifyDone) continue;
    const id = `gap-${c.id}`;
    if (gaps.some((g) => g.id === id)) continue;
    gaps.push({
      id,
      missingFact: `unresolved disagreement (${c.dimension})`,
      description: `Two sources disagree: ${c.claimA.slice(0, 80)} vs ${c.claimB.slice(0, 80)}`,
      whyItCouldChangeAnswer: c.impact,
      dependentConclusion: c.impact,
      resolvingEvidence: "scope-aligned verification or explicit preservation of uncertainty",
      importance: "blocking",
      sourceTypeNeeded: "primary-docs",
      remainingUncertainty: c.possibleExplanation,
      questionId: "q-compatibility",
      resolution: "open",
      dependencies: [c.passageAId, c.passageBId],
    });
  }

  const calcUnknown = (state.calculations ?? []).filter((c) => c.status === "unknown");
  for (const calc of calcUnknown) {
    const id = `calc-missing-${calc.id}`;
    if (gaps.some((g) => g.id === id)) continue;
    gaps.push({
      id,
      missingFact: `calculation ${calc.formulaName} lacks required input (${calc.missing.join(", ")})`,
      description: `calculation ${calc.formulaName} lacks required input`,
      whyItCouldChangeAnswer: "A material number cannot be computed",
      dependentConclusion: calc.formulaName,
      resolvingEvidence: `numeric inputs: ${calc.missing.join(", ")}`,
      importance: "blocking",
      remainingUncertainty: "Result stays unknown while inputs are missing.",
      resolution: "open",
    });
  }

  void opened;
  return gaps;
}

export function triedSourceType(state: ControllerState, sourceType: string): boolean {
  return (
    state.sources.some((s) => s.sourceType === sourceType) ||
    state.searches.some(
      (s) => (s.query ?? "").includes(sourceType) || (s.query ?? "").includes("compatibility matrix"),
    )
  );
}
