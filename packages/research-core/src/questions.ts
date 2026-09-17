import type { ControllerState, ResearchQuestion } from "./types.js";

function answeredByEvidence(state: ControllerState, requirement: RegExp): boolean {
  return state.passages.some((p) => requirement.test(p.exactText));
}

export function deriveResearchQuestions(state: ControllerState): ResearchQuestion[] {
  const q = state.brief.originalQuestion;
  const lower = q.toLowerCase();
  const questions: ResearchQuestion[] = [];

  const isCompare = /\bcompare\b|\bvs\.?\b|\balternatives?\b|\boptions?\b/i.test(lower);
  const isCompat = /\bcompatib|\beligible|\bworks with|\bsupport postgres|\bsupport(s|ed)?\b/i.test(lower);
  const isPrice = /\bcost|\bprice|\bbudget|\bEUR|\bUSD/i.test(lower);
  const isExistence = /\bdoes .+ (include|exist|offer)|is .+ a real|built-in/i.test(lower);
  const isLegal = /\btax|filing|jurisdiction|employment law|which law/i.test(lower);

  if (isCompat) {
    questions.push({
      id: "q-compatibility",
      text: "What does primary documentation establish about compatibility or eligibility under the named versions?",
      importance: "blocking",
      blocking: true,
      answerShape: "boolean",
      evidenceRequirement: "Official compatibility matrix or first-party support documentation for the named versions.",
      completionCondition: "A primary source has been opened that states support or incompatibility for the named versions.",
      dependentClaimIds: [],
      status: answeredByEvidence(state, /not compatible|incompatible|requires postgres|is supported/i)
        ? "answered"
        : state.sources.some((s) => (s.sourceType ?? "").includes("matrix") || s.sourceType === "vendor-docs")
          ? "answered"
          : "open",
    });
  }

  if (isCompare || isPrice) {
    const geo = state.constraints.find((c) => c.field === "geography");
    const budget = state.constraints.find((c) => c.field === "budget");
    questions.push({
      id: "q-eligibility",
      text: `Which inspected candidates satisfy the hard constraints${geo ? ` in ${geo.value}` : ""}${budget ? ` within ${budget.value} ${budget.units ?? ""}` : ""}?`,
      importance: "blocking",
      blocking: true,
      answerShape: "eligibility",
      evidenceRequirement: "First-party pricing or availability for each named candidate under the stated geography and budget.",
      completionCondition: "Each inspected candidate is marked satisfies, violates, or unknown with cited evidence.",
      dependentClaimIds: [],
      status: state.candidates.length > 0 ? "answered" : "open",
    });
  }

  if (isExistence && !isCompat) {
    questions.push({
      id: "q-existence",
      text: "Does a primary catalog or official source establish that the named product or feature exists?",
      importance: "blocking",
      blocking: true,
      answerShape: "existence",
      evidenceRequirement: "Catalog or official product page. Marketing roundups are not sufficient.",
      completionCondition: "A primary source confirms existence or states that no such product/feature exists.",
      dependentClaimIds: [],
      status: answeredByEvidence(state, /does not exist|no such (product|feature)|not a real product/i)
        ? "answered"
        : "open",
    });
  }

  if (isLegal) {
    questions.push({
      id: "q-jurisdiction",
      text: "What is the applicable rule in the confirmed jurisdiction as of the stated date?",
      importance: "blocking",
      blocking: !state.constraints.some((c) => c.field === "geography"),
      answerShape: "narrative",
      evidenceRequirement: "Primary legal or tax authority for the named jurisdiction.",
      completionCondition: "A jurisdiction-specific primary source has been opened.",
      dependentClaimIds: [],
      status: state.constraints.some((c) => c.field === "geography") && state.passages.length > 0 ? "answered" : "open",
    });
  }

  const pop = state.constraints.find((c) => c.field === "population");
  if (pop) {
    questions.push({
      id: "q-population",
      text: `What evidence applies to the stated population (${pop.value}) rather than a different cohort?`,
      importance: "blocking",
      blocking: true,
      answerShape: "numeric",
      evidenceRequirement: "A source that reports the same measure for the named population.",
      completionCondition: "At least one opened source is scoped to the named population, or the gap is recorded as unresolvable.",
      dependentClaimIds: [],
      status: state.sources.some((s) => /child|pediatric/i.test(s.population ?? "")) ? "answered" : "open",
    });
  }

  if (questions.length === 0) {
    questions.push({
      id: "q-primary",
      text: q.slice(0, 240),
      importance: "material",
      blocking: false,
      answerShape: "narrative",
      evidenceRequirement: "Opened sources that actually bear on the asked question.",
      completionCondition: "Decision-critical gaps are resolved or explicitly unresolvable and remaining actions have low expected value.",
      dependentClaimIds: [],
      status: state.passages.length > 0 ? "answered" : "open",
    });
  }

  return questions;
}
