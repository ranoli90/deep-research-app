import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { libraryItemCopy, libraryStatusLabel } from "../src/library-copy";

describe("library persistence metadata", () => {
  it("shows title, human status, last updated, and version when present", () => {
    const copy = libraryItemCopy({
      id: "run-1",
      title: "Best laptop under 2k",
      status: "completed",
      created_at: "2026-09-18T12:00:00.000Z",
      version: 2,
      report_id: "report-1",
    });
    expect(copy.title).toBe("Best laptop under 2k");
    expect(copy.status).toBe("Ready");
    expect(copy.updated).toBeTruthy();
    expect(copy.version).toBe("Version 2");
    expect(copy.preview).toBe("Answer ready.");
    expect(copy.changed).toBe(true);
    expect(copy.canResume).toBe(true);
  });

  it("collapses newlines in library titles to one line", () => {
    const copy = libraryItemCopy({
      id: "run-nl",
      title: "best laptop for local AI under 2k\nQuiet\nprefer",
      status: "completed_with_limitations",
    });
    expect(copy.title).toBe("best laptop for local AI under 2k Quiet prefer");
    expect(copy.title).not.toMatch(/\n/);
  });

  it("does not invent a version or updated time", () => {
    const copy = libraryItemCopy({ id: "run-2", title: "  ", status: "running" });
    expect(copy.title).toBe("Untitled research");
    expect(copy.status).toBe("Researching");
    expect(copy.updated).toBeNull();
    expect(copy.version).toBeNull();
    expect(copy.preview).toBe("Still researching.");
    expect(copy.changed).toBe(false);
    expect(libraryStatusLabel("awaiting_input")).toBe("Needs a detail");
  });

  it("virtualizes library rows and keeps search when the filter is empty", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/LibraryList.tsx"), "utf8");
    expect(src).toContain("FlatList");
    expect(src).toContain("No matching reports.");
    expect(src).toContain("styles.libraryRow");
    expect(src).toContain("placeholderTextColor={ink}");
    expect(src).toContain("maxFontSizeMultiplier={2}");
    expect(src).toContain("ShareIcon");
    expect(src).toContain("copy.preview");
    expect(src).toContain("styles.libraryMeta");
    expect(src).not.toContain("rgba(0,0,0,0.08)");
    expect(src).not.toMatch(/ScrollView style=\{styles\.body\}/);
  });
});
