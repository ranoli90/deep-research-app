import { ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
type Context = {
  question: string; task: ResearchModelOutput<"brief"> | null;
  passages: { id: string; text: string }[]; sources: { handle: string }[];
  assertions: ResearchModelOutput<"extract_assertions">["assertions"]; approvedClaimKeys: string[];
};
/** Referential/provenance validation, never semantic truth or permission inferred from a model. */
export function validateModelBindings(operation: ResearchModelOperation, raw: unknown, context: Context): string[] {
  const result = ResearchModelOutputs[operation].safeParse(raw);
  if (!result.success) return ["output_schema_mismatch"];
  const errors = new Set<string>();
  const unique = (keys: string[]) => { if (new Set(keys).size !== keys.length) errors.add("duplicate_model_key"); };
  const span = (item: { start: number; end: number; quote: string }, text: string) => {
    if (item.end <= item.start || text.slice(item.start, item.end) !== item.quote || item.end > text.length) errors.add("invalid_exact_span");
  };
  const quote = (item: { passageId: string; start: number; end: number; quote: string }) => {
    const passage = context.passages.find((p) => p.id === item.passageId);
    if (!passage) errors.add("unknown_evidence_handle"); else span(item, passage.text);
  };
  const known = (keys: string[], allowed: Set<string>) => { if (keys.some((key) => !allowed.has(key))) errors.add("unknown_model_handle"); };
  const criteria = new Set(context.task?.criteria.map((c) => c.key) ?? []);
  const questions = new Set(context.task?.questions.map((q) => q.key) ?? []);
  const assertions = new Set(context.assertions.map((c) => c.key));
  if (operation === "brief") {
    const data = raw as ResearchModelOutput<"brief">;
    span(data.objectiveProvenance, context.question);
    unique(data.criteria.map((c) => c.key)); unique(data.questions.map((q) => q.key));
    const ids = new Set(data.criteria.map((c) => c.key));
    for (const c of data.criteria) span(c.provenance, context.question);
    for (const exclusion of data.explicitExclusions) span(exclusion.provenance, context.question);
    for (const q of data.questions) known(q.criterionKeys, ids);
    for (const id of ids) if (!data.questions.some((q) => q.criterionKeys.includes(id))) errors.add("criterion_without_question");
    for (const c of data.criteria) if (data.criteria.some((other) => other.group === c.group && other.groupOperator !== c.groupOperator)) errors.add("inconsistent_criterion_group");
  } else if (operation === "extract_assertions") {
    const data = raw as ResearchModelOutput<"extract_assertions">;
    unique(data.candidates.map((c) => c.key)); unique(data.assertions.map((c) => c.key));
    const candidates = new Set(data.candidates.map((c) => c.key));
    for (const c of data.candidates) c.evidence.forEach(quote);
    for (const a of data.assertions) {
      if (a.candidateKey !== null) known([a.candidateKey], candidates);
      known(a.criterionKeys, criteria); a.evidence.forEach(quote);
    }
  } else if (operation === "assess_support") {
    const data = raw as ResearchModelOutput<"assess_support">;
    unique(data.assessments.map((a) => a.claimKey));
    for (const a of data.assessments) {
      known([a.claimKey], assertions); a.evidence.forEach(quote);
      if (["supported", "contradicted", "partially_supported"].includes(a.status) && !a.evidence.length) errors.add("support_without_evidence");
    }
    for (const key of assertions) if (!data.assessments.some((a) => a.claimKey === key)) errors.add("missing_claim_assessment");
  } else if (operation === "write_report") {
    const data = raw as ResearchModelOutput<"write_report">;
    const approved = new Set(context.approvedClaimKeys);
    for (const section of data.sections) for (const p of section.paragraphs) { known(p.claimKeys, approved); known(p.claimKeys, assertions); }
    known(data.unresolvedQuestionKeys, questions);
  } else if (operation === "review_coverage") {
    const data = raw as ResearchModelOutput<"review_coverage">;
    unique(data.questions.map((q) => q.questionKey));
    for (const q of data.questions) { known([q.questionKey], questions); known(q.assertionKeys, assertions);
      if (q.status === "supported" && !q.assertionKeys.length) errors.add("coverage_without_assertion"); }
    for (const key of questions) if (!data.questions.some((q) => q.questionKey === key)) errors.add("missing_question_review");
    for (const omitted of data.omittedRequirements) span(omitted.provenance, context.question);
  } else {
    const action = (raw as ResearchModelOutput<"propose_action">).action;
    if (action.type === "search") {
      span(action.publicQueryBasis, context.question); known(action.questionKeys, questions);
      // No terms from document text may be silently introduced into public search.
      const words = new Set(action.publicQueryBasis.quote.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []);
      if (!(action.query.match(/[\p{L}\p{N}]+/gu)?.length) || (action.query.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []).some((w) => !words.has(w))) errors.add("unapproved_public_query_terms");
    } else if (action.type === "fetch") { known([action.sourceHandle], new Set(context.sources.map((s) => s.handle))); known(action.questionKeys, questions); }
    else if (action.type === "assess_support") known(action.claimKeys, assertions);
    else if (action.type === "clarify") known(action.criterionKeys, criteria);
    else known(action.unresolvedQuestionKeys, questions);
  }
  return [...errors];
}
