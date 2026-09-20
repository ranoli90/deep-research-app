import type { ResearchModelOutput, ScopeComparisonContext, ScopeComparisonResult } from "@deep/contracts";
import { compareAssertionScopes, projectScopeComparison } from "./scope-comparison.js";

export const HIERARCHICAL_WRITE_VERSION = "hierarchical-write.v1";
export const RESEARCH_DRAFT_COMPOSITION_VERSION = "research-draft-composition.v1";

export type DraftCompositionSection = {
  questionKey: string;
  heading: string;
  claimKeys: string[];
  intentId: string;
  inputDigest: string;
};

export type ResearchDraftComposition = {
  version: typeof RESEARCH_DRAFT_COMPOSITION_VERSION;
  planVersion: typeof HIERARCHICAL_WRITE_VERSION;
  planDigest: string;
  sections: DraftCompositionSection[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Exact recorded section attempts. Null means a historical one-shot draft. */
export function parseDraftComposition(value: unknown): ResearchDraftComposition | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("writer_composition_invalid");
  const rec = value as Record<string, unknown>;
  if (rec.version !== RESEARCH_DRAFT_COMPOSITION_VERSION) throw new Error("writer_composition_invalid");
  if (rec.planVersion !== HIERARCHICAL_WRITE_VERSION || !isNonEmptyString(rec.planDigest) || !Array.isArray(rec.sections) || rec.sections.length < 1) {
    throw new Error("writer_composition_invalid");
  }
  const sections: DraftCompositionSection[] = rec.sections.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("writer_composition_invalid");
    const section = row as Record<string, unknown>;
    if (!isNonEmptyString(section.questionKey) || !isNonEmptyString(section.heading) || !isNonEmptyString(section.intentId) || !isNonEmptyString(section.inputDigest)) {
      throw new Error("writer_composition_invalid");
    }
    if (!Array.isArray(section.claimKeys) || !section.claimKeys.every((key) => typeof key === "string" && key.length > 0)) {
      throw new Error("writer_composition_invalid");
    }
    return {
      questionKey: section.questionKey,
      heading: section.heading,
      claimKeys: [...section.claimKeys],
      intentId: section.intentId,
      inputDigest: section.inputDigest,
    };
  });
  return { version: RESEARCH_DRAFT_COMPOSITION_VERSION, planVersion: HIERARCHICAL_WRITE_VERSION, planDigest: rec.planDigest, sections };
}

export function draftComposition(args: {
  planDigest: string;
  sections: DraftCompositionSection[];
}): ResearchDraftComposition {
  return parseDraftComposition({
    version: RESEARCH_DRAFT_COMPOSITION_VERSION,
    planVersion: HIERARCHICAL_WRITE_VERSION,
    planDigest: args.planDigest,
    sections: args.sections,
  })!;
}

type Task = ResearchModelOutput<"brief">;
type Assertion = ResearchModelOutput<"extract_assertions">["assertions"][number];
type WriterScopeComparison = ScopeComparisonResult | ScopeComparisonContext;

export type SectionWrite = {
  planVersion: typeof HIERARCHICAL_WRITE_VERSION;
  questionKey: string;
  questionText: string;
  heading: string;
  responsibility: string;
};

export type HierarchicalSection = {
  questionKey: string;
  heading: string;
  questionText?: string;
  responsibility?: string;
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
    const claimKeys = [...new Set(
      assertions
        .filter((a) => a.criterionKeys.some((key) => question.criterionKeys.includes(key)))
        .map((a) => a.key),
    )];
    for (const key of claimKeys) assigned.add(key);
    sections.push({
      questionKey: question.key,
      heading: question.importance === "critical" ? "Answer" : "Evidence",
      questionText: question.text,
      responsibility: question.importance === "critical"
        ? `Answer this section question using only this section's approved claims: ${question.text}`
        : `Provide supporting evidence for: ${question.text}`,
      claimKeys,
    });
  }
  const unusedClaimKeys = assertions.map((a) => a.key).filter((key) => !assigned.has(key));
  if (unusedClaimKeys.length) {
    sections.push({
      questionKey: "retained_evidence",
      heading: "Evidence",
      questionText: "Retained approved evidence not assigned to a brief question.",
      responsibility: "Preserve unused approved claims without mixing them into other section answers.",
      claimKeys: unusedClaimKeys,
    });
  }
  const complex = questions.length >= 3 || assertions.length >= 6 || (args.task?.intendedOutput === "comparison");
  return { version: HIERARCHICAL_WRITE_VERSION, complex, sections: sections.filter((s) => s.claimKeys.length), unusedClaimKeys };
}

/** Scope comparison is a lossless function of the assertions in this context; one claim has no pair. */
export function sectionScopeComparison(
  assertions: readonly Assertion[],
  current: WriterScopeComparison | undefined,
): WriterScopeComparison | undefined {
  if (!current || assertions.length < 2) return undefined;
  const list = [...assertions];
  const computed = compareAssertionScopes({ type: "compare_scopes", claimKeys: list.map((a) => a.key) }, list);
  return current.version === "scope-comparison-context.v1" ? projectScopeComparison(computed, list) : computed;
}

export function sectionWriteIdentity(section: HierarchicalSection): SectionWrite {
  const questionText = section.questionText?.trim() || section.heading;
  const responsibility = section.responsibility?.trim()
    || `Write the ${section.heading} section for ${section.questionKey}: ${questionText}`;
  return {
    planVersion: HIERARCHICAL_WRITE_VERSION,
    questionKey: section.questionKey,
    questionText,
    heading: section.heading,
    responsibility,
  };
}

/** Context for one section write: only that section's approved claims, plus stable section purpose. */
export function sectionWriterContext<T extends {
  approvedClaimKeys: readonly string[];
  assertions: readonly Assertion[];
  scopeComparison?: WriterScopeComparison;
}>(
  context: T,
  section: HierarchicalSection,
): T & { sectionWrite: SectionWrite } {
  const allowed = new Set(section.claimKeys);
  const assertions = context.assertions.filter((assertion) => allowed.has(assertion.key));
  return {
    ...context,
    approvedClaimKeys: [...allowed],
    assertions,
    scopeComparison: sectionScopeComparison(assertions, context.scopeComparison),
    sectionWrite: sectionWriteIdentity(section),
  };
}

/** Same procedure for execution and restoration. Never flatten keys across sections first. */
export function canonicalSectionContexts<T extends {
  approvedClaimKeys: readonly string[];
  assertions: readonly Assertion[];
  scopeComparison?: WriterScopeComparison;
}>(
  context: T,
  plan: HierarchicalWritePlan,
): Array<T & { sectionWrite: SectionWrite }> {
  return plan.sections.map((section) => sectionWriterContext(context, section));
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
