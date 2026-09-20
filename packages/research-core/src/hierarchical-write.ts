import type { ResearchModelOutput } from "@deep/contracts";

export const HIERARCHICAL_WRITE_VERSION = "hierarchical-write.v1";

type Task = ResearchModelOutput<"brief">;
type Assertion = ResearchModelOutput<"extract_assertions">["assertions"][number];

export type HierarchicalSection = {
  questionKey: string;
  heading: string;
  claimKeys: string[];
};

export type HierarchicalWritePlan = {
  version: typeof HIERARCHICAL_WRITE_VERSION;
  complex: boolean;
  sections: HierarchicalSection[];
  unusedClaimKeys: string[];
};

/** Complex jobs write section-by-section from approved claims. Citation identity stays the extract key. */
export function planHierarchicalWrite(args: {
  task: Task | null;
  approvedClaimKeys: readonly string[];
  assertions: readonly Assertion[];
}): HierarchicalWritePlan {
  const approved = new Set(args.approvedClaimKeys);
  const assertions = args.assertions.filter((a) => approved.has(a.key));
  const questions = args.task?.questions ?? [];
  const sections: HierarchicalSection[] = [];
  const assigned = new Set<string>();
  for (const question of questions) {
    const claimKeys = assertions
      .filter((a) => a.criterionKeys.some((key) => question.criterionKeys.includes(key)))
      .map((a) => a.key);
    for (const key of claimKeys) assigned.add(key);
    sections.push({
      questionKey: question.key,
      heading: question.importance === "critical" ? "Answer" : "Evidence",
      claimKeys,
    });
  }
  const unusedClaimKeys = assertions.map((a) => a.key).filter((key) => !assigned.has(key));
  if (unusedClaimKeys.length) {
    sections.push({ questionKey: "retained_evidence", heading: "Evidence", claimKeys: unusedClaimKeys });
  }
  const complex = questions.length >= 3 || assertions.length >= 6 || (args.task?.intendedOutput === "comparison");
  return { version: HIERARCHICAL_WRITE_VERSION, complex, sections: sections.filter((s) => s.claimKeys.length), unusedClaimKeys };
}

/** Context for one section write: only that section's approved claims. */
export function sectionWriterContext<T extends { approvedClaimKeys: readonly string[]; assertions: readonly Assertion[] }>(
  context: T,
  section: HierarchicalSection,
): T {
  const allowed = new Set(section.claimKeys);
  return {
    ...context,
    approvedClaimKeys: section.claimKeys,
    assertions: context.assertions.filter((assertion) => allowed.has(assertion.key)),
  };
}

/** Stitch section drafts without renaming claim keys or inventing prose. */
export function stitchSectionDrafts(
  sections: Array<ResearchModelOutput<"write_report">>,
): ResearchModelOutput<"write_report"> {
  const title = sections[0]?.title ?? "Answer";
  const unresolvedQuestionKeys = [...new Set(sections.flatMap((s) => s.unresolvedQuestionKeys))];
  const limitations = [...new Set(sections.flatMap((s) => s.limitations))];
  return {
    title,
    sections: sections.flatMap((s) => s.sections),
    unresolvedQuestionKeys,
    limitations,
  };
}
