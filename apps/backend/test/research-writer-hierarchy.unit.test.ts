import { describe, expect, it } from "vitest";
import { canonicalSectionContexts, compareAssertionScopes, draftComposition, parseDraftComposition, planHierarchicalWrite, projectScopeComparison, stitchSectionDrafts } from "@deep/research-core";
import { modelInputManifest } from "../src/modules/model-operations.js";

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
    expect(write.some((ctx) => ctx.assertions.map((a) => a.key).join(",") === "a1,a1,a2")).toBe(false);
    expect(write.every((ctx) => new Set(ctx.assertions.map((a) => a.key)).size === ctx.assertions.length)).toBe(true);
    const drafts = write.map((ctx, index) => ({
      title: "Answer",
      sections: [{
        heading: plan.sections[index]!.heading,
        paragraphs: ctx.assertions.map((a) => ({ text: a.text, claimKeys: [a.key] })),
      }],
      unresolvedQuestionKeys: [] as string[],
      limitations: [] as string[],
    }));
    const stitched = stitchSectionDrafts(drafts);
    expect(stitched.sections).toHaveLength(3);
    expect(JSON.stringify(write)).toEqual(JSON.stringify(restore));
    expect(write[0]?.sectionWrite?.questionText).toBe("One");
    expect(write[1]?.sectionWrite?.questionText).toBe("Two");
    expect(write[0]?.sectionWrite?.questionText).not.toBe(write[1]?.sectionWrite?.questionText);
    expect(JSON.stringify(write[0])).not.toEqual(JSON.stringify(write[1]));
  });

  it("distinguishes eligibility vs why-it-matters sections that share the same evidence", () => {
    const reproduction = {
      ...task,
      questions: [
        { key: "q1", text: "Is the option eligible?", criterionKeys: ["c1"], importance: "critical" as const, evidenceStandard: "docs" },
        { key: "q2", text: "Why does that eligibility matter?", criterionKeys: ["c1"], importance: "useful" as const, evidenceStandard: "docs" },
        { key: "q3", text: "What else is known?", criterionKeys: ["c2"], importance: "useful" as const, evidenceStandard: "docs" },
      ],
    };
    const plan = planHierarchicalWrite({ task: reproduction as never, approvedClaimKeys: ["a1", "a2"], assertions });
    const contexts = canonicalSectionContexts({ approvedClaimKeys: ["a1", "a2"], assertions }, plan);
    expect(contexts[0]?.approvedClaimKeys).toEqual(["a1"]);
    expect(contexts[1]?.approvedClaimKeys).toEqual(["a1"]);
    expect(contexts[0]?.sectionWrite?.questionText).toBe("Is the option eligible?");
    expect(contexts[1]?.sectionWrite?.questionText).toBe("Why does that eligibility matter?");
    expect(JSON.stringify(contexts[0])).not.toEqual(JSON.stringify(contexts[1]));
    const base = {
      question: "Is the option eligible?",
      task: reproduction as never,
      passages: [] as const,
      sources: [] as const,
      assertions,
      approvedClaimKeys: ["a1", "a2"] as const,
      draft: null,
    };
    const write = canonicalSectionContexts(base, plan);
    expect(modelInputManifest(write[0] as never).version).toBe("model-input.v8");
    expect(modelInputManifest(write[0] as never)).not.toEqual(modelInputManifest(write[1] as never));
    expect((modelInputManifest(write[0] as never) as { sectionWrite?: { questionText: string } }).sectionWrite?.questionText).toBe("Is the option eligible?");
    expect((modelInputManifest(write[1] as never) as { sectionWrite?: { questionText: string } }).sectionWrite?.questionText).toBe("Why does that eligibility matter?");
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

  it("records exact section intent ids and treats missing composition as one-shot", () => {
    const recorded = draftComposition({
      planDigest: "abc",
      sections: [
        { questionKey: "q1", heading: "Answer", claimKeys: ["a1"], intentId: "11111111-1111-4111-8111-111111111111", inputDigest: "d1" },
        { questionKey: "q2", heading: "Evidence", claimKeys: ["a1"], intentId: "22222222-2222-4222-8222-222222222222", inputDigest: "d2" },
      ],
    });
    expect(parseDraftComposition(recorded)?.sections.map((section) => section.intentId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(parseDraftComposition(null)).toBeNull();
    expect(() => parseDraftComposition({ version: "research-draft-composition.v1" })).toThrow(/writer_composition_invalid/);
  });
});
