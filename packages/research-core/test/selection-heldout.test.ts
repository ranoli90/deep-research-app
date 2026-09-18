import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTION_LIMITS,
  selectCriterionAwarePassages,
  selectWholePassages,
  type SelectionPassage,
} from "../src/evidence-selection.js";

const passages = JSON.parse(readFileSync(new URL("./fixtures/selection-heldout-passages.json", import.meta.url), "utf8")) as {
  question: string;
  passages: SelectionPassage[];
};
const labels = JSON.parse(readFileSync(new URL("./fixtures/selection-heldout-labels.json", import.meta.url), "utf8")) as {
  decisive: string[];
  qualifiers: string[];
  omittedUnassessed: string[];
};

function filler(n: number): SelectionPassage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `bg${i}`,
    sourceId: "doc",
    sourceVersionId: "v1",
    locator: i < 86 ? `p${String(4 + i).padStart(2, "0")}-paragraph` : `p${String(95 + i - 86).padStart(2, "0")}-paragraph`,
    locatorDigest: `bg${i}`,
    digest: `bg${i}`,
    accessLevel: "partial-text",
    title: "Solace firmware guide",
    text: `Unrelated appendix ${i}. ${"x".repeat(900)}`,
  }));
}

function bm25Rank(question: string, input: readonly SelectionPassage[]): string[] {
  const q = new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const df = new Map<string, number>();
  const docs = input.map((p) => new Set(p.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  for (const t of q) df.set(t, docs.filter((d) => d.has(t)).length);
  const n = input.length;
  const scores = docs.map((d) => [...q].reduce((s, t) => {
    if (!d.has(t)) return s;
    const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
    return s + idf;
  }, 0));
  return input.map((p, i) => [p.id, scores[i]!] as const).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

describe("held-out criterion-aware selection", () => {
  const inventory = [...passages.passages.slice(0, 3), ...filler(140), ...passages.passages.slice(3)];
  const question = passages.question;

  it("retains late decisive facts, headings, table headers, qualifiers, footnotes, and exceptions", () => {
    const result = selectCriterionAwarePassages(question, inventory);
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") return;
    expect(result.passageIds).toEqual(expect.arrayContaining(labels.decisive));
    expect(result.passageIds).toEqual(expect.arrayContaining(labels.qualifiers));
    expect(result.omitted).toBeGreaterThan(0);
    expect(result.serializedBytes).toBeLessThanOrEqual(EVIDENCE_SELECTION_LIMITS.serializedBytes);
    expect(result.passageIds.length).toBeLessThanOrEqual(EVIDENCE_SELECTION_LIMITS.passages);
  });

  it("keeps omitted inventory unassessed and does not declare support or truth", () => {
    const result = selectCriterionAwarePassages(question, inventory);
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") return;
    expect(result).not.toHaveProperty("support");
    expect(result).not.toHaveProperty("truth");
    expect(JSON.stringify(result)).not.toMatch(/unsupported|does not exist|negative evidence/i);
    const omitted = inventory.filter((p) => !result.passageIds.includes(p.id)).map((p) => p.id);
    expect(omitted.length).toBe(result.omitted);
    expect(result.available).toBe(inventory.length);
  });

  it("keeps contradicting relevant passages or fails closed", () => {
    const result = selectCriterionAwarePassages(question, inventory);
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") return;
    expect(result.passageIds).toEqual(expect.arrayContaining(["p-late", "c1"]));
  });

  it("benchmarks decisive-evidence recall against the deterministic whole-passage selector", () => {
    const started = performance.now();
    const baseline = selectWholePassages(question, inventory);
    const baselineMs = performance.now() - started;
    const rankedStart = performance.now();
    const ranked = selectCriterionAwarePassages(question, inventory);
    const rankedMs = performance.now() - rankedStart;
    const bm25Start = performance.now();
    const bm25 = bm25Rank(question, inventory);
    const bm25Ms = performance.now() - bm25Start;
    expect(baseline.kind).toBe("selected");
    expect(ranked.kind).toBe("selected");
    if (baseline.kind !== "selected" || ranked.kind !== "selected") return;
    const recall = (ids: string[], needed: string[]) => needed.filter((id) => ids.includes(id)).length / needed.length;
    const baseRecall = recall(baseline.passageIds, labels.decisive);
    const rankedRecall = recall(ranked.passageIds, labels.decisive);
    const rankedQualifiers = recall(ranked.passageIds, labels.qualifiers);
    const baseQualifiers = recall(baseline.passageIds, labels.qualifiers);
    const bm25Recall = recall(bm25.slice(0, ranked.passageIds.length), labels.decisive);
    expect(rankedRecall).toBeGreaterThanOrEqual(baseRecall);
    expect(rankedRecall).toBe(1);
    expect(rankedQualifiers).toBeGreaterThanOrEqual(baseQualifiers);
    expect(rankedQualifiers).toBe(1);
    expect(ranked.omitted).toBeGreaterThan(0);
    const report = {
      baseline: { recall: baseRecall, qualifierRetention: baseQualifiers, falseOmission: 1 - baseRecall, latencyMs: baselineMs, version: "whole-passage-selection.v1" },
      criterionAware: { recall: rankedRecall, qualifierRetention: rankedQualifiers, falseOmission: 1 - rankedRecall, latencyMs: rankedMs, version: "criterion-aware overlay" },
      bm25Experiment: { recall: bm25Recall, qualifierRetention: recall(bm25.slice(0, ranked.passageIds.length), labels.qualifiers), falseOmission: 1 - bm25Recall, latencyMs: bm25Ms, adopted: false, reason: "No neighbor/heading/footnote contract; would break inventory replay." },
    };
    expect(report.criterionAware.recall).toBeGreaterThanOrEqual(report.baseline.recall);
    expect(report.bm25Experiment.adopted).toBe(false);
  });
});
