import { describe, expect, it } from "vitest";
import { applySnapshot, canSubmit, conciseBlocks, emptyState, restoreAfterReopen } from "../src/state.js";

describe("P0-N native state mapping", () => {
  it("maps composer gates for consent, auth, offline, and empty draft", () => {
    const base = emptyState();
    expect(canSubmit(base).ok).toBe(false);
    expect(canSubmit({ ...base, draft: "Q" }).reason).toMatch(/sign in/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true }).reason).toMatch(/consent/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true, consentGranted: true, offline: true }).reason).toMatch(/offline/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true, consentGranted: true }).ok).toBe(true);
  });

  it("close/reopen restores draft and last run without cancelling the server job", () => {
    const s = applySnapshot(
      { ...emptyState(), draft: "Compare options in Germany", signedIn: true, consentGranted: true },
      { runId: "r1", lifecycle: "running", phase: "writing", outcome: null, reportId: null, labeledDemo: true },
    );
    const restored = restoreAfterReopen(s);
    expect(restored.draft).toContain("Germany");
    expect(restored.run?.runId).toBe("r1");
    expect(restored.run?.phase).toBe("writing");
    expect(restored.source).toBeNull();
  });

  it("concise and detailed views share the same answer block identity", () => {
    const blocks = [
      { id: "answer", kind: "text", text: "Vendor A fits the 50 EUR Germany constraint.", claimIds: ["c1"], citationIds: ["p1"] },
      { id: "independence", kind: "text", text: "One origin cluster.", claimIds: [], citationIds: ["p1"] },
      { id: "untrusted-source", kind: "caveat", text: "Source was untrusted data.", claimIds: [], citationIds: ["p1"] },
    ];
    const concise = conciseBlocks(blocks);
    expect(concise[0]?.id).toBe("answer");
    expect(concise[0]?.citationIds).toEqual(blocks[0]?.citationIds);
    expect(concise.some((b) => b.kind === "caveat")).toBe(true);
  });

  it("cancel and correction statuses are distinct", () => {
    const cancelled = applySnapshot(emptyState(), {
      runId: "r1",
      lifecycle: "terminal",
      phase: "writing",
      outcome: "cancelled",
      reportId: null,
      labeledDemo: true,
    });
    expect(cancelled.status).toBe("cancelled");
    const done = applySnapshot(emptyState(), {
      runId: "r2",
      lifecycle: "terminal",
      phase: "writing",
      outcome: "completed",
      reportId: "rep",
      labeledDemo: true,
    });
    expect(done.status).toBe("completed");
  });
});
