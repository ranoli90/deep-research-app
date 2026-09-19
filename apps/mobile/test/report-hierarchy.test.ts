import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editorialSections, reportOutline } from "../src/report-hierarchy";
import type { ReportBlock } from "../src/state";

const block = (id: string, kind: string, text: string): ReportBlock => ({
  id, kind, text, claimIds: [], citationIds: [],
});

describe("editorial report hierarchy", () => {
  it("orders answer first, then factors, comparison, caveats, unresolved, calculations, and evidence", () => {
    const sections = editorialSections([
      block("comparison-table", "table", "A | B"),
      block("body", "text", "Supporting passage"),
      block("eligibility", "text", "Vendor A fits."),
      block("contradiction-price", "caveat", "Prices disagree."),
      block("unresolved-warranty", "text", "Warranty length is unresolved."),
      block("calculation-dose", "code", "12 * 40"),
      block("answer", "text", "Buy Vendor A under $2,000."),
    ]);
    expect(sections.map((s) => s.id)).toEqual([
      "answer", "factors", "comparison", "caveats", "unresolved", "calculations", "evidence",
    ]);
    expect(sections[0]?.blocks[0]?.text).toMatch(/Buy Vendor A/);
    expect(reportOutline(sections).map((o) => o.title)).toContain("Deciding factors");
  });

  it("does not drop unknown blocks or duplicate ids", () => {
    const extra = block("custom-note", "text", "Extra context");
    const sections = editorialSections([block("answer", "text", "A"), extra, extra]);
    const evidence = sections.find((s) => s.id === "evidence");
    expect(evidence?.blocks).toHaveLength(1);
    expect(evidence?.blocks[0]?.id).toBe("custom-note");
  });

  it("shows an outline and sources-used count on detailed reports", () => {
    const report = readFileSync(join(import.meta.dirname, "../src/ReportView.tsx"), "utf8");
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("showOutline={detailed}");
    expect(app).toContain("onJump=");
    expect(report).toContain("Sources used:");
    expect(report).toContain('accessibilityLabel="Report outline"');
    expect(report).toContain("Jump to ${section.title}");
    expect(report).not.toMatch(/<Text style=\{styles\.kicker\}>Outline<\/Text>/);
  });
});
