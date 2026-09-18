import type { ResearchModelOutput } from "@deep/contracts";

export const BRIEF_CRITERION_LINK_VERSION = "brief-criterion-question-link.v1";

function questionKey(criterionKey: string, used: Set<string>): string {
  const base = `linked_${criterionKey}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  let key = base || "linked_criterion";
  let n = 2;
  while (used.has(key)) {
    const suffix = `_${n}`;
    key = `${base.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
    n += 1;
  }
  return key;
}

/**
 * Structural repair only: every brief criterion must be referenced by a question.
 * Does not rewrite the original question, invent quotes, or drop criteria.
 */
export function repairBriefCriterionLinks(output: ResearchModelOutput<"brief">): {
  output: ResearchModelOutput<"brief">;
  linked: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[];
  version: typeof BRIEF_CRITERION_LINK_VERSION;
} {
  const data: ResearchModelOutput<"brief"> = {
    ...output,
    criteria: output.criteria.map((c) => ({ ...c })),
    questions: output.questions.map((q) => ({ ...q, criterionKeys: [...q.criterionKeys] })),
  };
  const usedQuestionKeys = new Set(data.questions.map((q) => q.key));
  const covered = new Set(data.questions.flatMap((q) => q.criterionKeys));
  const linked: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[] = [];
  for (const criterion of data.criteria) {
    if (covered.has(criterion.key)) continue;
    if (data.questions.length >= 24) continue;
    const key = questionKey(criterion.key, usedQuestionKeys);
    usedQuestionKeys.add(key);
    const quoted = criterion.provenance.quote.trim();
    data.questions.push({
      key,
      text: (quoted || criterion.description).slice(0, 4000),
      criterionKeys: [criterion.key],
      importance: criterion.importance === "hard" ? "critical" : "useful",
      evidenceStandard: "Primary evidence, or record the answer as unknown if none exists.",
    });
    covered.add(criterion.key);
    linked.push({ criterionKey: criterion.key, questionKey: key, attachedToExisting: false });
  }
  return { output: data, linked, version: BRIEF_CRITERION_LINK_VERSION };
}
