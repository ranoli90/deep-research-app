import { describe, expect, it } from "vitest";
import { RESEARCH_STATUS_LINE, researchStatusLine } from "../src/research-status";
import { emptyState } from "../src/state";

const run = {
  runId: "592be93e-5060-4410-a802-af2ff6dfebfd",
  lifecycle: "running" as const,
  phase: "researching",
  outcome: null as string | null,
  reportId: null as string | null,
  labeledDemo: false,
};

describe("research status one-liners", () => {
  it("uses one line each for offline, failed, cancelled, and waiting", () => {
    expect(researchStatusLine({ ...emptyState(), offline: true })).toEqual({
      kind: "offline",
      line: RESEARCH_STATUS_LINE.offline,
      retry: true,
    });
    expect(researchStatusLine({ ...emptyState(), run: { ...run, lifecycle: "terminal", outcome: "failed" } })).toEqual({
      kind: "failed",
      line: RESEARCH_STATUS_LINE.failed,
      retry: true,
    });
    expect(researchStatusLine({ ...emptyState(), run: { ...run, lifecycle: "terminal", outcome: "cancelled" } })).toEqual({
      kind: "cancelled",
      line: RESEARCH_STATUS_LINE.cancelled,
      retry: false,
    });
    expect(researchStatusLine({ ...emptyState(), run, events: [] })).toEqual({
      kind: "waiting",
      line: RESEARCH_STATUS_LINE.waiting,
      retry: true,
    });
  });

  it("does not replace an active event trail with the waiting line", () => {
    expect(researchStatusLine({
      ...emptyState(),
      run,
      events: [{ sequence: 1, activity: null }],
    })).toBeNull();
  });

  it("prefers offline over failed when both apply", () => {
    expect(researchStatusLine({
      ...emptyState(),
      offline: true,
      run: { ...run, lifecycle: "terminal", outcome: "failed" },
    })?.kind).toBe("offline");
  });

  it("skips status lines for invalidated content", () => {
    expect(researchStatusLine({
      ...emptyState(),
      run: { ...run, lifecycle: "terminal", outcome: "cancelled", contentInvalidated: true },
    })).toBeNull();
  });
});
