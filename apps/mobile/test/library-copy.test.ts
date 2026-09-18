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
    expect(copy.canResume).toBe(true);
  });

  it("does not invent a version or updated time", () => {
    const copy = libraryItemCopy({ id: "run-2", title: "  ", status: "running" });
    expect(copy.title).toBe("Untitled research");
    expect(copy.status).toBe("Researching");
    expect(copy.updated).toBeNull();
    expect(copy.version).toBeNull();
    expect(libraryStatusLabel("awaiting_input")).toBe("Needs a detail");
  });
});
