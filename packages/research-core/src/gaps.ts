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

function isOpened(accessLevel: string | undefined): boolean {
  return accessLevel === "full-text" || accessLevel === "partial-text" || accessLevel === "abstract";
}

function managedGapId(id: string): boolean {
  return (
    id === "compat-primary" ||
    id === "population" ||
    id === "geo-unverified" ||
    id === "primary-inaccessible" ||
    id === "stale-price" ||
    id.startsWith("gap-contradiction") ||
    id.startsWith("calc-missing-")
  );
}

/**
 * Recompute derived gaps from current evidence. Prior rows with the same id
 * are replaced so gold/primary evidence can resolve a previously open gap.
 */
export function detectGaps(state: ControllerState): Gap[] {
  if (state.ablations?.disableGapDetection) return [...state.gaps];
  const gaps: Gap[] = state.gaps.filter((g) => !managedGapId(g.id));
  const q = state.brief.originalQuestion.toLowerCase();
  const types = new Set(state.sources.map((s) => s.sourceType ?? "web"));

  if (needsPrimaryEvidence(q) || /compatib|eligible|works with|support postgres/i.test(q)) {
    const hasOpenedPrimary = state.sources.some(
      (s) => PRIMARY_SOURCE_TYPES.has(s.sourceType ?? "") && isOpened(s.accessLevel),
    );
    const onlySummaries =
      state.sources.length > 0 &&
      state.sources.every(
        (s) => WEAK_SOURCE_TYPES.has(s.sourceType ?? "review-summary") || isWeakSourceClass(s),
      );
    const attempts = attemptsFor(state, "vendor-matrix");
    if (hasOpenedPrimary) {
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
    } else if (onlySummaries || types.has("review-summary")) {
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

  const pop = state.constraints.find((c) => c.field === "population");
  if (pop && /child|pediatric|under/i.test(pop.value)) {
    const pediatric = state.sources.some((s) => /child|pediatric/i.test(s.population ?? "") && isOpened(s.accessLevel));
    const attempts = attemptsFor(state, "population-specific");
    if (pediatric) {
      gaps.push({
        id: "population",
        missingFact: "population-specific evidence",
        description: "population-specific evidence",
        whyItCouldChangeAnswer: "Adult figures may not apply",
        dependentConclusion: "numeric claims applied to the stated population",
        resolvingEvidence: "a source that reports the same measure for the named population",
        importance: "material",
        sourceTypeNeeded: "population-specific",
        preferredSourceTypes: ["population-specific", "primary-docs"],
        suggestedQuery: `${state.brief.originalQuestion} pediatric children population`,
        attempts,
        latestOutcome: "resolved",
        remainingUncertainty: "A population-scoped source was opened.",
        questionId: "q-population",
        resolution: "resolved",
      });
    } else {
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
        latestOutcome: attempts.length ? attempts[attempts.length - 1]!.outcome : "untried",
        remainingUncertainty: "Adult-only figures cannot be generalized to the stated population.",
        questionId: "q-population",
        resolution: "open",
      });
    }
  }

  const geo = state.constraints.find((c) => c.field === "geography" && c.importance === "hard");
  const openedSources = state.sources.filter((s) => isOpened(s.accessLevel));
  if (geo && openedSources.length > 0) {
    const geoVal = String(geo.value).toLowerCase();
    const mentionedInOpened =
      state.passages.some((p) => p.exactText.toLowerCase().includes(geoVal)) ||
      openedSources.some((s) => `${s.locator} ${s.title} ${s.snippet ?? ""}`.toLowerCase().includes(geoVal));
    if (mentionedInOpened) {
      gaps.push({
        id: "geo-unverified",
        missingFact: `hard geographic constraint (${geo.value}) has not been verified`,
        description: `Opened sources mention ${geo.value}`,
        whyItCouldChangeAnswer: "Eligibility and legal answers can change by jurisdiction",
        dependentConclusion: "any geography-sensitive conclusion",
        resolvingEvidence: `a source that is scoped to ${geo.value}`,
        importance: "material",
        sourceTypeNeeded: "primary-docs",
        preferredSourceTypes: ["primary-docs", "regulator"],
        latestOutcome: "resolved",
        remainingUncertainty: `Geography ${geo.value} is attested in an opened source.`,
        resolution: "resolved",
      });
    } else {
      const inspectedWithoutMention = openedSources.length > 0;
      gaps.push({
        id: "geo-unverified",
        missingFact: `hard geographic constraint (${geo.value}) has not been verified`,
        description: `hard geographic constraint (${geo.value}) has not been verified`,
        whyItCouldChangeAnswer: "Eligibility and legal answers can change by jurisdiction",
        dependentConclusion: "any geography-sensitive conclusion",
        resolvingEvidence: `a source that is scoped to ${geo.value}`,
        importance: inspectedWithoutMention ? "material" : "blocking",
        sourceTypeNeeded: "primary-docs",
        preferredSourceTypes: ["primary-docs", "regulator"],
        suggestedQuery: `${state.brief.originalQuestion} ${geo.value}`,
        remainingUncertainty: "Opened sources do not mention the named jurisdiction. Putting the country in a search query is not verification.",
        latestOutcome: inspectedWithoutMention ? "unverified_after_inspect" : "untried",
        resolution: "open",
      });
    }
  }

  const blockedPrimary = state.sources.filter(
    (s) => PRIMARY_SOURCE_TYPES.has(s.sourceType ?? "") && (s.accessLevel === "blocked" || s.accessLevel === "failed"),
  );
  if (blockedPrimary.length) {
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
    if (dated.length) {
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
    gaps.push({
      id: `gap-${c.id}`,
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
    gaps.push({
      id: `calc-missing-${calc.id}`,
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
