import { describe, expect, it } from "vitest";
import { citationNumbers } from "../src/citation-chips";
import { editorialSections, reportNeedsOutline } from "../src/report-hierarchy";
import { readingOffset, readingScrollY, visibleReadingBlock } from "../src/report-layout";
import type { ReportBlock } from "../src/state";

function block(i: number): ReportBlock {
  const citation = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    id: i === 0 ? "answer" : `section-${i}`,
    kind: i % 17 === 0 ? "table" : "text",
    text: i % 17 === 0 ? `Vendor | Price\nA | ${i}` : `Finding ${i} with enough prose to exercise wrapping and citations.`,
    claimIds: [`00000000-0000-4000-8001-${String(i).padStart(12, "0")}`],
    citationIds: [citation],
  };
}

describe("synthetic 100-block / 100-citation report workload", () => {
  it("numbers citations, builds a TOC, and restores reading position without dropping identities", () => {
    const blocks = Array.from({ length: 100 }, (_, i) => block(i));
    const started = Date.now();
    const index = citationNumbers(blocks);
    const sections = editorialSections(blocks);
    expect(reportNeedsOutline(sections)).toBe(true);
    expect(Object.keys(index)).toHaveLength(100);
    expect(index[blocks[0]!.citationIds[0]!]).toBe(1);
    expect(index[blocks[99]!.citationIds[0]!]).toBe(100);
    const positions: Record<string, number> = {};
    for (let i = 0; i < blocks.length; i++) positions[blocks[i]!.id] = i * 48;
    const visible = visibleReadingBlock(positions, 80, 80 + 48 * 40);
    expect(visible).toBe("section-40");
    const offset = readingOffset(2000, 80, positions["section-40"]!);
    expect(readingScrollY(80, positions["section-40"]!, offset)).toBe(2000);
    expect(Date.now() - started).toBeLessThan(250);
  });
});
