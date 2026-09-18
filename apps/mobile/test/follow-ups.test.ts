import { describe, expect, it } from "vitest";
import { followUpSuggestions } from "../src/follow-ups";
import type { ReportBlock } from "../src/state";

const block = (id: string, kind: string, text: string): ReportBlock => ({
  id, kind, text, claimIds: [], citationIds: [],
});

describe("follow-up chips from the report", () => {
  it("takes at most three unresolved, caveat, and limitation lines without inventing prompts", () => {
    const chips = followUpSuggestions({
      blocks: [
        block("answer", "text", "Buy a used ThinkPad."),
        block("unresolved-warranty", "text", "Warranty length is unresolved."),
        block("contradiction-price", "caveat", "Street prices disagree with list prices."),
        block("limitation-thermals", "text", "Thermals under long inference were not measured."),
      ],
      limitations: ["Did not inspect in-store stock."],
    });
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.prompt)).toEqual([
      "Warranty length is unresolved.",
      "Thermals under long inference were not measured.",
      "Street prices disagree with list prices.",
    ]);
    expect(chips.every((c) => c.label.length <= 42)).toBe(true);
  });

  it("returns nothing when the report has no open questions", () => {
    expect(followUpSuggestions({
      blocks: [block("answer", "text", "Vendor A fits the budget.")],
      limitations: [],
    })).toEqual([]);
  });

  it("dedupes the same unresolved text from caveats and limitations", () => {
    const chips = followUpSuggestions({
      blocks: [
        block("unresolved-a", "text", "Warranty length is unresolved."),
        block("contradiction-x", "caveat", "warranty length is unresolved."),
      ],
      limitations: ["Warranty length is unresolved.", "Thermals were not measured."],
    });
    expect(chips.map((c) => c.prompt)).toEqual([
      "Warranty length is unresolved.",
      "Thermals were not measured.",
    ]);
  });
});
