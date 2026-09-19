import { describe, expect, it } from "vitest";
import { extractPublicUrl, liveSourcePillsFromEvents } from "../src/live-source-appearance";
import { citationChipLabel } from "../src/citation-chips";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("live source appearance", () => {
  it("extracts only safe public http(s) URLs and never invents hosts", () => {
    expect(extractPublicUrl("Searched: laptops under 2000")).toBeNull();
    expect(extractPublicUrl("Opened manufacturer spec.")).toBeNull();
    expect(extractPublicUrl("Opened https://www.nvidia.com/laptops")).toBe("https://www.nvidia.com/laptops");
    expect(extractPublicUrl("See http://user:pass@evil.example/x")).toBeNull();
    expect(extractPublicUrl("ftp://files.example/a")).toBeNull();
  });

  it("builds during-search pills only when events carry a real URL, deduped by domain", () => {
    expect(liveSourcePillsFromEvents([
      { sequence: 1, type: "accepted", publicSummary: "Research accepted." },
      { sequence: 2, type: "searched", publicSummary: "Searched: pricing" },
      { sequence: 3, type: "opened_source", publicSummary: "Opened manufacturer spec." },
    ])).toEqual([]);

    expect(liveSourcePillsFromEvents([
      { sequence: 1, type: "searched", publicSummary: "Searched https://docs.python.org/3/" },
    ])).toEqual([]);
    const pills = liveSourcePillsFromEvents([
      { sequence: 1, type: "searched", publicSummary: "Searched https://docs.python.org/3/" },
      { sequence: 2, type: "opened_source", publicSummary: "Opened https://docs.python.org/3/library/sqlite3.html" },
      { sequence: 3, type: "opened_source", publicSummary: "Opened https://developer.mozilla.org/en-US/" },
      { sequence: 4, type: "writing", publicSummary: "Writing https://example.com should not pill" },
    ]);
    expect(pills.map((p) => p.domain)).toEqual(["docs.python.org", "developer.mozilla.org"]);
    expect(pills.every((p) => p.faviconUri === null)).toBe(true);
  });

  it("after-search citation chips stay numbered without UUIDs; domain is optional and known-only", () => {
    expect(citationChipLabel(1)).toBe("[1]");
    expect(citationChipLabel(2, "nvidia.com")).toBe("[2] · nvidia.com");
    expect(citationChipLabel(1, "  ")).toBe("[1]");
    const report = readFileSync(join(import.meta.dirname, "../src/ReportView.tsx"), "utf8");
    expect(report).toContain("citationChipLabel(index)");
    expect(report).not.toMatch(/citationIds.*slice\(0,\s*8\)/);
    const sheet = readFileSync(join(import.meta.dirname, "../src/SourceSheet.tsx"), "utf8");
    expect(sheet.indexOf("publisher")).toBeLessThan(sheet.indexOf("source.exactText"));
    expect(sheet).toContain("Technical details");
  });

  it("activity renders source pills only from the live-source helper", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/ResearchActivity.tsx"), "utf8");
    expect(src).toContain("liveSourcePillsFromEvents");
    expect(src).toContain('accessibilityLabel="Sources found"');
    expect(src).not.toMatch(/favicon.*(google|duckduckgo|gstatic)/i);
  });
});
