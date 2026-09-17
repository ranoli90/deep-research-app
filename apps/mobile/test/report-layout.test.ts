import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { breakLongTokens, formatChangeSummary, needsHorizontalScroll, parseTable } from "../src/report-layout.js";

describe("M04 report layout", () => {
  it("inserts break opportunities in long unbroken URLs and code tokens", () => {
    const url = "https://example.test/" + "a".repeat(80);
    const broken = breakLongTokens(url);
    expect(broken).toContain("\u200b");
    expect(broken.replace(/\u200b/g, "")).toBe(url);
    expect(breakLongTokens("short café 漢字")).toBe("short café 漢字");
  });

  it("parses a wide markdown table without dropping cells", () => {
    const text = [
      "Vendor | Region | Price | Currency | Status | Evidence",
      "---|---|---|---|---|---",
      "Vendor A | germany | 40 | EUR | satisfies | p1",
      "Vendor B | germany | 40 | EUR | ineligible (geography) | p2",
    ].join("\n");
    const rows = parseTable(text);
    expect(rows[0]).toEqual(["Vendor", "Region", "Price", "Currency", "Status", "Evidence"]);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.[0]).toBe("Vendor A");
    expect(rows[2]?.[4]).toMatch(/geography/);
  });

  it("tables and code require nested horizontal scroll, body text does not", () => {
    expect(needsHorizontalScroll("table")).toBe(true);
    expect(needsHorizontalScroll("code")).toBe(true);
    expect(needsHorizontalScroll("text")).toBe(false);
    expect(needsHorizontalScroll("caveat")).toBe(false);
  });

  it("App.tsx renders table and code inside nested horizontal ScrollViews", () => {
    const src = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(src).toMatch(/nestedScrollEnabled/);
    expect(src).toMatch(/block\.kind === "table"/);
    expect(src).toMatch(/block\.kind === "code"/);
    expect(src).toMatch(/citeRow/);
    expect(src).toMatch(/breakLongTokens/);
    expect(src).toMatch(/styles\.sheetBody/);
    expect(src).toMatch(/accessibilityLabel="Change summary"/);
    expect(src).toMatch(/Share previous report as Markdown/);
  });

  it("M08 change summary keeps a follow-up note without claiming a new conclusion", () => {
    const text = formatChangeSummary({
      evidenceUpdated: true,
      conclusionChanged: false,
      newlyFeasible: [],
      notes: "Targeted follow-up verified the named claim without reopening candidate discovery.",
    });
    expect(text).toMatch(/without reopening candidate discovery/);
    expect(text).toMatch(/Earlier conclusion kept/);
  });
});
it("structured comparison does not imply that a prior conclusion was carried forward",()=>{
 const notes="Assertions: 0 added, 0 removed, 1 unchanged. Reused cited source versions: 1.";
 expect(formatChangeSummary({evidenceUpdated:false,conclusionChanged:false,notes,comparison:{version:"report-changes.v1"}})).toBe(notes);
});
