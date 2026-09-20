import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ENG-032 production writer", () => {
  it("writes complex reports section-by-section and stitches owned drafts", () => {
    const writer = readFileSync(join(import.meta.dirname, "../src/worker/research-writer.ts"), "utf8");
    const restore = readFileSync(join(import.meta.dirname, "../src/modules/scoped-support.ts"), "utf8");
    expect(writer).toContain("stitchSectionDrafts");
    expect(writer).toContain("sectionWriterContext");
    expect(writer).toContain("outline.complex && outline.sections.length>1");
    expect(restore).toContain("stitchSectionDrafts");
    expect(restore).toContain("sectionWriterContext");
  });
});
