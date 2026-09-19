import { ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
import { extractConstraints } from "./brief.js";

export const MODEL_SPAN_RESOLUTION_VERSION = "unique-owned-passage-quote.v2";
type Span = { start: number; end: number; quote: string };
export type SpanResolution = { path: string; proposedStart: number; proposedEnd: number; start: number; end: number; passageId?: string };
export type LocatedPassageQuote = Span & { passageId: string };

function validSpan(item: Span, text: string): boolean {
  return item.end > item.start && item.end <= text.length && text.slice(item.start, item.end) === item.quote;
}

/** Unique occurrence only. Flexible whitespace is for passage quotes, never to invent text. */
export function locateUniqueQuote(text: string, quote: string, opts: { flexibleWhitespace?: boolean } = {}): Span | null {
  if (!quote) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0 && text.indexOf(quote, exact + 1) === -1) {
    return { start: exact, end: exact + quote.length, quote: text.slice(exact, exact + quote.length) };
  }
  if (!opts.flexibleWhitespace) return null;
  const trimmed = quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’.…]+$/g, "");
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 && trimmed.length < 12) return null;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(escaped.join("\\s+"), "gi");
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1 || matches[0]!.index == null) return null;
  const start = matches[0]!.index;
  const end = start + matches[0]![0]!.length;
  return { start, end, quote: text.slice(start, end) };
}

function uniqueHits(quote: string, passages: { id: string; text: string }[]): LocatedPassageQuote[] {
  const hits: LocatedPassageQuote[] = [];
  for (const passage of passages) {
    const found = locateUniqueQuote(passage.text, quote, { flexibleWhitespace: true });
    if (found) hits.push({ passageId: passage.id, ...found });
  }
  return hits;
}

/**
 * Locate an extraction quote in owned passages. Prefers the cited passage; otherwise the
 * unique owned passage that contains the quote (or its longest unique prefix/suffix).
 * Never invents text or picks an ambiguous match.
 */
export function locateOwnedPassageQuote(
  quote: string,
  citedPassageId: string,
  passages: { id: string; text: string }[],
): LocatedPassageQuote | null {
  const cited = passages.find((p) => p.id === citedPassageId);
  if (cited) {
    const found = locateUniqueQuote(cited.text, quote, { flexibleWhitespace: true });
    if (found) return { passageId: cited.id, ...found };
  }
  const exact = uniqueHits(quote, passages);
  if (exact.length === 1) return exact[0]!;
  const tokens = quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’.…]+$/g, "").split(/\s+/).filter(Boolean);
  const max = Math.min(tokens.length, 80);
  for (let len = max; len >= 4; len--) {
    const windows = [tokens.slice(0, len).join(" ")];
    if (len < tokens.length) windows.push(tokens.slice(tokens.length - len).join(" "));
    for (const window of windows) {
      if (window.length < 24) continue;
      const hits = uniqueHits(window, passages);
      if (hits.length === 1) return hits[0]!;
    }
  }
  return null;
}

/** Resolve coordinates only. Extraction may retarget a unique owned passage; support never switches handles. */
export function resolveModelSpans<K extends ResearchModelOperation>(operation: K, raw: unknown,
  context: { question: string; passages: { id: string; text: string }[] }) {
  const output = ResearchModelOutputs[operation].parse(raw) as ResearchModelOutput<K>;
  const resolutions: SpanResolution[] = [];
  function span(item: Span, text: string, path: string) {
    if (validSpan(item, text)) return;
    const found = locateUniqueQuote(text, item.quote);
    if (!found) return;
    resolutions.push({ path, proposedStart: item.start, proposedEnd: item.end, start: found.start, end: found.end });
    item.start = found.start; item.end = found.end; item.quote = found.quote;
  }
  function evidence(items: (Span & { passageId: string })[], path: string) {
    items.forEach((item, index) => {
      const matches = context.passages.filter(p => p.id === item.passageId);
      if (matches.length !== 1) return;
      const text = matches[0]!.text;
      if (validSpan(item, text)) return;
      const found = locateUniqueQuote(text, item.quote, { flexibleWhitespace: true });
      if (!found) return;
      resolutions.push({ path: `${path}.${index}`, proposedStart: item.start, proposedEnd: item.end, start: found.start, end: found.end });
      item.start = found.start; item.end = found.end; item.quote = found.quote;
    });
  }
  function extractEvidence(items: (Span & { passageId: string })[], path: string) {
    items.forEach((item, index) => {
      const cited = context.passages.find((p) => p.id === item.passageId);
      if (cited && validSpan(item, cited.text)) return;
      const found = locateOwnedPassageQuote(item.quote, item.passageId, context.passages);
      if (!found) return;
      resolutions.push({
        path: `${path}.${index}`, proposedStart: item.start, proposedEnd: item.end,
        start: found.start, end: found.end, passageId: found.passageId,
      });
      item.passageId = found.passageId;
      item.start = found.start;
      item.end = found.end;
      item.quote = found.quote;
    });
  }
  if (operation === "brief") {
    const data = output as ResearchModelOutput<"brief">;
    span(data.objectiveProvenance, context.question, "objectiveProvenance");
    data.criteria.forEach((c, i) => span(c.provenance, context.question, `criteria.${i}.provenance`));
    data.explicitExclusions.forEach((e, i) => span(e.provenance, context.question, `explicitExclusions.${i}.provenance`));
  } else if (operation === "extract_assertions") {
    const data = output as ResearchModelOutput<"extract_assertions">;
    data.candidates.forEach((c, i) => extractEvidence(c.evidence, `candidates.${i}.evidence`));
    data.assertions.forEach((a, i) => extractEvidence(a.evidence, `assertions.${i}.evidence`));
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

function uniqueSpan(question: string, needle: string): Span | null {
  if (!needle) return null;
  const exact = question.indexOf(needle);
  if (exact >= 0 && question.indexOf(needle, exact + 1) === -1) {
    return { start: exact, end: exact + needle.length, quote: needle };
  }
  const lower = question.toLowerCase();
  const q = needle.toLowerCase();
  const i = lower.indexOf(q);
  if (i >= 0 && lower.indexOf(q, i + 1) === -1) {
    return { start: i, end: i + needle.length, quote: question.slice(i, i + needle.length) };
  }
  return null;
}

/** Replace invalid brief provenances with unique question spans for the same stated field. Never invent quotes. */
export function repairBriefProvenanceFromQuestion(output: ResearchModelOutput<"brief">, question: string): ResearchModelOutput<"brief"> {
  const next = structuredClone(output);
  const extracted = extractConstraints(question);
  const apply = (item: Span, needles: string[]) => {
    if (validSpan(item, question)) return;
    for (const needle of needles) {
      const found = uniqueSpan(question, needle);
      if (found) {
        item.start = found.start;
        item.end = found.end;
        item.quote = found.quote;
        return;
      }
    }
  };
  apply(next.objectiveProvenance, [next.objectiveProvenance.quote]);
  for (const criterion of next.criteria) {
    const known = extracted.find((c) => c.field === criterion.field);
    const needles = [
      criterion.provenance.quote,
      ...(known?.value ? [String(known.value)] : []),
      ...(criterion.value ? [criterion.value] : []),
    ];
    if (criterion.field === "budget") {
      const compact = question.match(/\b(?:under|below|at most|less than|<=)\s*(?:\$|€|£)?\s*\d+(?:[.,]\d+)?\s*[kK]?(?:\s*(?:USD|EUR|GBP))?\b/i);
      if (compact) needles.unshift(compact[0]);
    }
    apply(criterion.provenance, needles);
  }
  for (const exclusion of next.explicitExclusions) apply(exclusion.provenance, [exclusion.provenance.quote, exclusion.text]);
  return next;
}

/** Bind support assessments to extracted claims. Never invent quotes; reuse extract evidence when the model handle is unusable. */
export function repairSupportAssessments(
  output: ResearchModelOutput<"assess_support">,
  assertions: ResearchModelOutput<"extract_assertions">["assertions"],
  passages: { id: string; text: string }[],
): ResearchModelOutput<"assess_support"> {
  const known = new Set(assertions.map((a) => a.key));
  const unused = new Set(known);
  const repaired: ResearchModelOutput<"assess_support">["assessments"] = [];
  for (const assessment of output.assessments) {
    let key = assessment.claimKey;
    if (!known.has(key)) {
      if (unused.size !== 1) continue;
      key = [...unused][0]!;
    }
    unused.delete(key);
    const assertion = assertions.find((a) => a.key === key)!;
    const evidence = assessment.evidence.filter((item) => {
      const passage = passages.find((p) => p.id === item.passageId);
      return passage != null && validSpan(item, passage.text);
    });
    repaired.push({
      ...assessment,
      claimKey: key,
      scope: assessment.scope,
      evidence: evidence.length ? evidence : assertion.evidence,
    });
  }
  for (const key of unused) {
    const assertion = assertions.find((a) => a.key === key)!;
    repaired.push({
      claimKey: key,
      status: "supported",
      evidence: assertion.evidence,
      scope: assertion.scope,
      rationale: "Support reused the extracted claim evidence after the model omitted a usable assessment.",
      missingEvidence: [],
    });
  }
  return { assessments: repaired };
}

/** Drop citations to passages the model was not given. Never invent replacement quotes. */
export function dropUnownedEvidenceHandles(
  output: ResearchModelOutput<"extract_assertions">,
  passageIds: ReadonlySet<string>,
): ResearchModelOutput<"extract_assertions"> {
  const next = structuredClone(output);
  const owned = <T extends { passageId: string }>(evidence: T[]) => evidence.filter((e) => passageIds.has(e.passageId));
  next.candidates = next.candidates.map((c) => ({ ...c, evidence: owned(c.evidence) })).filter((c) => c.evidence.length);
  const candidateKeys = new Set(next.candidates.map((c) => c.key));
  next.assertions = next.assertions
    .map((a) => ({ ...a, evidence: owned(a.evidence) }))
    .filter((a) => a.evidence.length && (a.candidateKey === null || candidateKeys.has(a.candidateKey)));
  return next;
}

/** Keep only extraction quotes that are exact owned passage slices. */
export function dropUnresolvedExtractionSpans(
  output: ResearchModelOutput<"extract_assertions">,
  passages: { id: string; text: string }[],
): ResearchModelOutput<"extract_assertions"> {
  const byId = new Map(passages.map((p) => [p.id, p.text]));
  const next = structuredClone(output);
  const keep = (evidence: (Span & { passageId: string })[]) =>
    evidence.filter((e) => {
      const text = byId.get(e.passageId);
      return text != null && validSpan(e, text);
    });
  next.candidates = next.candidates.map((c) => ({ ...c, evidence: keep(c.evidence) })).filter((c) => c.evidence.length);
  const candidateKeys = new Set(next.candidates.map((c) => c.key));
  next.assertions = next.assertions
    .map((a) => ({ ...a, evidence: keep(a.evidence) }))
    .filter((a) => a.evidence.length && (a.candidateKey === null || candidateKeys.has(a.candidateKey)));
  return next;
}

/** Drop writer citations that are not approved owned claims. Never invent replacement keys. */
export function dropUnapprovedWriterClaims<T extends ResearchModelOutput<"write_report" | "write_calculated_report">>(
  output: T,
  allowedClaimKeys: ReadonlySet<string>,
  allowedQuestionKeys: ReadonlySet<string>,
  allowedCalculationKeys: ReadonlySet<string> = new Set(),
): T {
  const next = structuredClone(output);
  next.sections = next.sections
    .map((section) => ({
      ...section,
      paragraphs: section.paragraphs
        .map((p) => ({ ...p, claimKeys: p.claimKeys.filter((k) => allowedClaimKeys.has(k)) }))
        .filter((p) => p.claimKeys.length),
    }))
    .filter((section) => section.paragraphs.length);
  next.unresolvedQuestionKeys = next.unresolvedQuestionKeys.filter((k) => allowedQuestionKeys.has(k));
  if ("calculationKeys" in next) {
    (next as ResearchModelOutput<"write_calculated_report">).calculationKeys =
      (next as ResearchModelOutput<"write_calculated_report">).calculationKeys.filter((k) => allowedCalculationKeys.has(k));
  }
  return next;
}

/** Keep the first candidate/assertion for each key. Duplicate keys are model errors, not new entities. */
export function uniquifyExtractionKeys(
  output: ResearchModelOutput<"extract_assertions">,
): ResearchModelOutput<"extract_assertions"> {
  const next = structuredClone(output);
  const seenCandidates = new Set<string>();
  next.candidates = next.candidates.filter((c) => {
    if (seenCandidates.has(c.key)) return false;
    seenCandidates.add(c.key);
    return true;
  });
  const seenAssertions = new Set<string>();
  next.assertions = next.assertions.filter((a) => {
    if (seenAssertions.has(a.key)) return false;
    seenAssertions.add(a.key);
    return a.candidateKey === null || seenCandidates.has(a.candidateKey);
  });
  return next;
}
