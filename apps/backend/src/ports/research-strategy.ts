import type { ResearchModelOutput } from "@deep/contracts";
import { nextCriterionSearch } from "@deep/research-core";

export const RESEARCH_STRATEGIES = ["iterative-baseline.v1", "criterion-adaptive.v1"] as const;
export type ResearchStrategy = typeof RESEARCH_STRATEGIES[number];
export const DEFAULT_RESEARCH_STRATEGY: ResearchStrategy = "criterion-adaptive.v1";
export function researchStrategy(value: unknown): ResearchStrategy {
  if (value === undefined) return DEFAULT_RESEARCH_STRATEGY;
  if (value === RESEARCH_STRATEGIES[0] || value === RESEARCH_STRATEGIES[1]) return value;
  throw new Error("invalid_research_strategy");
}

/** Both arms use the same permitted query construction and limit. Only selection differs. */
export function nextStrategySearch(strategy: ResearchStrategy, args: {
  question: string; task: ResearchModelOutput<"brief">; unresolvedCriterionKeys: string[]; queries: string[];
  ceiling?: number;
}) {
  if (strategy === "criterion-adaptive.v1") return nextCriterionSearch(args);
  // A credible fixed-plan baseline iterates while coverage is incomplete. Its plan is independent
  // of the model's current gap prioritization, in the user's original question order.
  const criteria = [...args.task.criteria].sort((a, b) => a.provenance.start - b.provenance.start);
  return nextCriterionSearch({ ...args, task: { ...args.task, criteria }, unresolvedCriterionKeys: criteria.map(c => c.key) });
}
