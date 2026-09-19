import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_LABEL_MAX,
  FOLLOW_UP_PROMPT_MAX,
  asFollowUpQuestion,
  draftFromFollowUp,
  followUpSuggestions,
} from "../src/follow-ups";
import type { ReportBlock } from "../src/state";

const block = (id: string, kind: string, text: string): ReportBlock => ({
  id, kind, text, claimIds: [], citationIds: [],
});

describe("follow-up chips from the report", () => {
  it("takes at most three unresolved, caveat, and limitation lines as short questions", () => {
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
      "What is warranty length?",
      "What about thermals under long inference?",
      "Reconcile street prices with list prices?",
    ]);
    expect(chips.every((c) => c.label.length <= FOLLOW_UP_LABEL_MAX)).toBe(true);
    expect(chips.every((c) => c.prompt.length <= FOLLOW_UP_PROMPT_MAX)).toBe(true);
    expect(chips.every((c) => c.prompt.endsWith("?"))).toBe(true);
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
      "What is warranty length?",
      "What about thermals?",
    ]);
  });

  it("never dumps multi-kilobyte caveat prose into the draft prompt", () => {
    const wall = `${"Price variance across EU retailers remains unresolved. ".repeat(400)}`;
    expect(wall.length).toBeGreaterThan(10_000);
    const chips = followUpSuggestions({
      blocks: [block("unresolved-price", "text", wall)],
      limitations: [],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]!.prompt.length).toBeLessThanOrEqual(FOLLOW_UP_PROMPT_MAX);
    expect(chips[0]!.prompt.endsWith("?") || chips[0]!.prompt.endsWith("…")).toBe(true);
  });

  it("keeps existing questions and builds replace_question drafts with a short Also clause", () => {
    expect(asFollowUpQuestion("Which vendor ships to Germany?")).toBe("Which vendor ships to Germany?");
    expect(draftFromFollowUp({
      prompt: "What is warranty length?",
      originalQuestion: "Compare used ThinkPads under 800 EUR",
      replaceQuestion: true,
    })).toBe("Compare used ThinkPads under 800 EUR Also: What is warranty length?");
    expect(draftFromFollowUp({
      prompt: "What is warranty length?",
      originalQuestion: "Compare used ThinkPads under 800 EUR",
      replaceQuestion: false,
    })).toBe("What is warranty length?");
  });

  it("does not turn research-process caveats into Resolve dumps", () => {
    const chips = followUpSuggestions({
      blocks: [
        block("unresolved-warranty", "text", "Warranty length is unresolved."),
        block("caveat-disconfirm", "caveat", "Disconfirmation remains unresolved. Absence of a recorded counterexample is not proof."),
        block("caveat-spend", "caveat", "App-level spend counters are not a guarantee of opaque provider-internal cost."),
      ],
      limitations: [
        "Later searches added no new source families.",
        "Fixture or bounded live route; not an exhaustive literature review.",
      ],
    });
    expect(chips.map((c) => c.prompt)).toEqual(["What is warranty length?"]);
    expect(chips.every((c) => !c.prompt.startsWith("Resolve "))).toBe(true);
  });

  it("keeps chips above the composer and visible while the keyboard is open", () => {
    const src = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(src).toMatch(/accessibilityLabel="Suggested follow-ups"/);
    expect(src).toMatch(/draftFromFollowUp/);
    const followIdx = src.indexOf('accessibilityLabel="Suggested follow-ups"');
    const composerIdx = src.indexOf("<ResearchComposer");
    expect(followIdx).toBeGreaterThan(-1);
    expect(composerIdx).toBeGreaterThan(followIdx);
    expect(src.slice(followIdx, composerIdx)).not.toMatch(/keyboardOpen/);
    expect(src).not.toContain("accessibilityRole=\"tablist\"");
  });
});
