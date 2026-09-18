import { ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";

export const MODEL_SPAN_RESOLUTION_VERSION = "unique-exact-quote-offsets.v1";
type Span = { start: number; end: number; quote: string };
export type SpanResolution = { path: string; proposedStart: number; proposedEnd: number; start: number; end: number };
/** Resolve coordinates only. Never rewrite quotes, switch evidence handles, or infer support. */
export function resolveModelSpans<K extends ResearchModelOperation>(operation: K, raw: unknown,
  context: { question: string; passages: { id: string; text: string }[] }) {
  const output = ResearchModelOutputs[operation].parse(raw) as ResearchModelOutput<K>;
  const resolutions: SpanResolution[] = [];
  function span(item: Span, text: string, path: string) {
    if (item.end > item.start && text.slice(item.start, item.end) === item.quote && item.end <= text.length) return;
    const start = text.indexOf(item.quote);
    // Repeated exact text is ambiguous, including overlapping occurrences. Existing validator rejects it.
    if (start < 0 || text.indexOf(item.quote, start + 1) !== -1) return;
    const end = start + item.quote.length;
    resolutions.push({ path, proposedStart: item.start, proposedEnd: item.end, start, end });
    item.start = start; item.end = end;
  }
  function evidence(items: (Span & { passageId: string })[], path: string) {
    items.forEach((item, index) => {
      const matches = context.passages.filter(p => p.id === item.passageId);
      if (matches.length === 1) span(item, matches[0]!.text, `${path}.${index}`);
    });
  }
  if (operation === "brief") {
    const data = output as ResearchModelOutput<"brief">;
    span(data.objectiveProvenance, context.question, "objectiveProvenance");
    data.criteria.forEach((c, i) => span(c.provenance, context.question, `criteria.${i}.provenance`));
    data.explicitExclusions.forEach((e, i) => span(e.provenance, context.question, `explicitExclusions.${i}.provenance`));
  } else if (operation === "extract_assertions") {
    const data = output as ResearchModelOutput<"extract_assertions">;
    data.candidates.forEach((c, i) => evidence(c.evidence, `candidates.${i}.evidence`));
    data.assertions.forEach((a, i) => evidence(a.evidence, `assertions.${i}.evidence`));
  } else if (operation === "assess_support") {
    (output as ResearchModelOutput<"assess_support">).assessments.forEach((a, i) => evidence(a.evidence, `assessments.${i}.evidence`));
  } else if (operation === "review_coverage" || operation === "review_calculated_coverage") {
    (output as ResearchModelOutput<"review_coverage">).omittedRequirements.forEach((r, i) => span(r.provenance, context.question, `omittedRequirements.${i}.provenance`));
  } else if (operation === "propose_action") {
    const action = (output as ResearchModelOutput<"propose_action">).action;
    if (action.type === "search") span(action.publicQueryBasis, context.question, "action.publicQueryBasis");
  }
  return { output, resolutions, version: MODEL_SPAN_RESOLUTION_VERSION };
}
