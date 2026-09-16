import type { Constraint } from "@deep/contracts";

export type ImpactSet = {
  changedInputs: string[];
  invalidatedObjects: string[];
  reopenedDiscoveryScopes: string[];
  preservedObjects: string[];
  reason: string;
  dependencyCompleteness: "known" | "partial" | "unknown";
};

export function impactForCorrection(args: {
  previousConstraints: Constraint[];
  nextConstraints: Constraint[];
  reopenedDiscovery: boolean;
  dependencyCompleteness: ImpactSet["dependencyCompleteness"];
}): ImpactSet {
  const changed: string[] = [];
  for (const n of args.nextConstraints) {
    const prev = args.previousConstraints.find((p) => p.field === n.field);
    if (!prev || prev.value !== n.value) changed.push(n.field);
  }
  const reopened = args.reopenedDiscovery ? ["candidate-discovery"] : [];
  const completeness = args.reopenedDiscovery ? args.dependencyCompleteness : args.dependencyCompleteness;
  return {
    changedInputs: changed,
    invalidatedObjects: reopened.length ? ["feasibility", "conclusions"] : ["affected-claims"],
    reopenedDiscoveryScopes: reopened,
    preservedObjects: ["inspected-passages-if-freshness-holds"],
    reason: args.reopenedDiscovery
      ? "Hard constraint relaxed; previously excluded candidates may now be eligible"
      : "Targeted correction; recompute dependents",
    dependencyCompleteness: completeness,
  };
}

export function shouldFullRerun(impact: ImpactSet): boolean {
  return impact.dependencyCompleteness !== "known" || impact.reopenedDiscoveryScopes.length > 0;
}
