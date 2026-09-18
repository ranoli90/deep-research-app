import { describe, expect, it } from "vitest";
import { citationChipLabel, citationNumbers } from "../src/citation-chips";
import type { ReportBlock } from "../src/state";

const block = (id: string, citationIds: string[]): ReportBlock => ({
  id, kind: "text", text: id, claimIds: [], citationIds,
});

describe("numbered citation chips", () => {
  it("numbers sources in first-appearance order and does not use the raw id", () => {
    const numbers = citationNumbers([
      block("answer", ["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"]),
      block("body", ["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "cccccccc-3333-4333-8333-cccccccccccc"]),
    ]);
    expect(numbers["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"]).toBe(1);
    expect(numbers["bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"]).toBe(2);
    expect(numbers["cccccccc-3333-4333-8333-cccccccccccc"]).toBe(3);
    expect(citationChipLabel(1)).toBe("1");
    expect(citationChipLabel(2, "nvidia.com")).toBe("2 · nvidia.com");
    expect(citationChipLabel(0)).toBe("");
  });

  it("does not invent numbers for blocks without citations", () => {
    expect(citationNumbers([block("answer", [])])).toEqual({});
  });
});
