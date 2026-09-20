import { describe, expect, it } from "vitest";
import { canonicalSectionContexts, compareAssertionScopes, planHierarchicalWrite, projectScopeComparison } from "@deep/research-core";

const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const assertions = [
  { key: "a1", candidateKey: null, criterionKeys: ["c1"], text: "A", scope, quantities: [], evidence: [] },
  { key: "a2", candidateKey: null, criterionKeys: ["c2"], text: "B", scope, quantities: [], evidence: [] },
];
const task = {
  questions: [
    { key: "q1", text: "One", criterionKeys: ["c1"], importance: "critical" as const, evidenceStandard: "docs" },
    { key: "q2", text: "Two", criterionKeys: ["c1"], importance: "useful" as const, evidenceStandard: "docs" },
    { key: "q3", text: "Three", criterionKeys: ["c2"], importance: "useful" as const, evidenceStandard: "docs" },
  ],
  criteria: [],
  objective: "x",
  objectiveProvenance: { start: 0, end: 1, quote: "x" },
  intendedOutput: "comparison" as const,
  assumptions: [],
  openAmbiguities: [],
  explicitExclusions: [],
};

describe("ENG-032 canonical section write/restore", () => {
  it("uses the same section contexts for write and restore on shared criteria", () => {
    const basis = { approvedClaimKeys: ["a1", "a2"], assertions };
    const plan = planHierarchicalWrite({ task: task as never, approvedClaimKeys: basis.approvedClaimKeys, assertions });
    const write = canonicalSectionContexts(basis, plan);
    const restore = canonicalSectionContexts(basis, plan);
    expect(write.map((ctx) => ctx.approvedClaimKeys)).toEqual(restore.map((ctx) => ctx.approvedClaimKeys));
    expect(write.map((ctx) => ctx.assertions.map((a) => a.key))).toEqual([["a1"], ["a1"], ["a2"]]);
    expect(write.map((ctx) => ctx.assertions)).toHaveLength(3);
    expect(write[0]?.assertions).toHaveLength(1);
    expect(write[1]?.assertions).toHaveLength(1);
    expect(JSON.stringify(write)).toEqual(JSON.stringify(restore));
  });

  it("drops job-level scope comparison from singleton section writes and restore matches", () => {
    const result = compareAssertionScopes({ type: "compare_scopes", claimKeys: ["a1", "a2"] }, assertions);
    const basis = {
      approvedClaimKeys: ["a1", "a2"],
      assertions,
      scopeComparison: projectScopeComparison(result, assertions),
    };
    const plan = planHierarchicalWrite({ task: task as never, approvedClaimKeys: basis.approvedClaimKeys, assertions });
    const write = canonicalSectionContexts(basis, plan);
    const restore = canonicalSectionContexts(basis, plan);
    expect(write.every((ctx) => ctx.assertions.length === 1 && ctx.scopeComparison === undefined)).toBe(true);
    expect(JSON.stringify(write)).toEqual(JSON.stringify(restore));
  });

  it("reprojects scope comparison onto a section that still has two claims", () => {
    const shared = [
      { ...assertions[0]!, key: "a1", criterionKeys: ["c1"] },
      { ...assertions[0]!, key: "a1b", criterionKeys: ["c1"] },
      assertions[1]!,
    ];
    const result = compareAssertionScopes({ type: "compare_scopes", claimKeys: shared.map((a) => a.key) }, shared);
    const basis = {
      approvedClaimKeys: shared.map((a) => a.key),
      assertions: shared,
      scopeComparison: projectScopeComparison(result, shared),
    };
    const plan = planHierarchicalWrite({ task: task as never, approvedClaimKeys: basis.approvedClaimKeys, assertions: shared });
    const write = canonicalSectionContexts(basis, plan);
    const twoClaim = write.find((ctx) => ctx.assertions.length === 2);
    const oneClaim = write.find((ctx) => ctx.assertions.length === 1);
    expect(twoClaim).toBeDefined();
    expect(oneClaim).toBeDefined();
    expect(twoClaim?.scopeComparison).toEqual(
      projectScopeComparison(
        compareAssertionScopes({ type: "compare_scopes", claimKeys: twoClaim!.assertions.map((a) => a.key) }, [...twoClaim!.assertions]),
        [...twoClaim!.assertions],
      ),
    );
    expect(oneClaim?.scopeComparison).toBeUndefined();
    expect(JSON.stringify(write)).toEqual(JSON.stringify(canonicalSectionContexts(basis, plan)));
  });

  it("keeps a one-question draft on the single-write path", () => {
    const simple = {
      ...task,
      questions: [task.questions[0]!],
      intendedOutput: "recommendation" as const,
    };
    const plan = planHierarchicalWrite({
      task: simple as never,
      approvedClaimKeys: ["a1"],
      assertions: [assertions[0]!],
    });
    expect(plan.complex).toBe(false);
    expect(plan.sections).toHaveLength(1);
  });
});
