import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("one-sentence composer copy", () => {
  it("keeps a simple empty state and an obvious research action", () => {
    const composer = readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8");
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(composer).toContain('placeholder="What should I research?"');
    expect(composer).toContain('accessibilityLabel="Start research"');
    expect(composer).toContain("{pendingAdmission ? \"Retry\" : \"Research\"}");
    expect(app).toContain("Ask anything. One sentence is enough. Files are optional.");
    expect(app).toContain("<ResearchComposer");
    expect(app).not.toMatch(/Ask a comparison with hard constraints/);
  });
});
