import type { Constraint } from "@deep/contracts";
import type { StoredClaim, Gap, ResearchQuestion } from "./types.js";

export type ImpactSet = {
  changedInputs: string[];
  invalidatedObjects: string[];
  reopenedDiscoveryScopes: string[];
  preservedObjects: string[];
  reason: string;
  dependencyCompleteness: "known" | "partial" | "unknown";
  affectedConstraintIds?: string[];
  affectedQuestionIds?: string[];
  affectedGapIds?: string[];
  invalidatedClaimIds?: string[];
  reusedEvidenceIds?: string[];
};

export function impactForCorrection(args: {
  previousConstraints: Constraint[];
  nextConstraints: Constraint[];
  reopenedDiscovery: boolean;
  dependencyCompleteness: ImpactSet["dependencyCompleteness"];
  previousQuestions?: ResearchQuestion[];
  nextQuestions?: ResearchQuestion[];
  claims?: StoredClaim[];
  gaps?: Gap[];
  reusablePassageIds?: string[];
}): ImpactSet {
  const changed: string[] = [];
  const affectedConstraintIds: string[] = [];
  for (const n of args.nextConstraints) {
    const prev = args.previousConstraints.find((p) => p.field === n.field && p.value === n.value && p.units === n.units);
    if (!prev) {
      changed.push(n.field);
      affectedConstraintIds.push(n.id);
    }
  }
  for (const p of args.previousConstraints) {
    const still = args.nextConstraints.find((n) => n.field === p.field && n.value === p.value && n.units === p.units);
    if (!still && !changed.includes(p.field)) {
      changed.push(p.field);
      affectedConstraintIds.push(p.id);
    }
  }

  const affectedQuestionIds =
    args.nextQuestions
      ?.filter((q) => args.previousQuestions?.some((p) => p.id === q.id && (p.text !== q.text || p.status !== q.status)))
      .map((q) => q.id) ?? [];

  const affectedGapIds =
    args.gaps
      ?.filter((g) => changed.some((field) => (g.missingFact + (g.dependentConclusion ?? "")).toLowerCase().includes(field)))
      .map((g) => g.id) ?? [];

  const invalidatedClaimIds =
    args.claims
      ?.filter((c) => changed.some((field) => c.text.toLowerCase().includes(field) || /eligib|feasib|budget|price|dose|linux|geography/i.test(c.text)))
      .map((c) => c.id) ?? (args.reopenedDiscovery ? ["feasibility", "conclusions"] : ["affected-claims"]);

  const reopened = args.reopenedDiscovery ? ["candidate-discovery"] : [];
  const completeness = args.dependencyCompleteness;
  return {
    changedInputs: changed,
    invalidatedObjects: reopened.length ? ["feasibility", "conclusions"] : ["affected-claims"],
    reopenedDiscoveryScopes: reopened,
    preservedObjects: ["inspected-passages-if-freshness-holds"],
    reason: args.reopenedDiscovery
      ? "Hard constraint relaxed; previously excluded candidates may now be eligible"
      : "Targeted correction; recompute dependents",
    dependencyCompleteness: completeness,
    affectedConstraintIds,
    affectedQuestionIds,
    affectedGapIds,
    invalidatedClaimIds: Array.isArray(invalidatedClaimIds) ? invalidatedClaimIds : [],
    reusedEvidenceIds: args.reusablePassageIds ?? [],
  };
}

export function shouldFullRerun(impact: ImpactSet): boolean {
  return impact.dependencyCompleteness === "unknown";
}
