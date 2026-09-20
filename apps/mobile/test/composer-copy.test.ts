import { describe, expect, it } from "vitest";
import { composerPlaceholder } from "../src/composer-copy";

describe("composer placeholders", () => {
  it("uses empty, researching, and follow-up copy without planner chrome", () => {
    expect(composerPlaceholder({ inProgress: false, continues: false })).toBe("Ask anything…");
    expect(composerPlaceholder({ inProgress: true, continues: false })).toBe("Ask or refine research…");
    expect(composerPlaceholder({ inProgress: true, continues: true })).toBe("Ask or refine research…");
    expect(composerPlaceholder({ inProgress: false, continues: true })).toBe("Ask a follow-up…");
  });
});
