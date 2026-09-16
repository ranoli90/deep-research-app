import { describe, expect, it } from "vitest";
import { applySnapshot, canSubmit, conciseBlocks, emptyState, openLibraryItem } from "../src/state.js";
import { hydrateOnLaunch, memoryStore, persistSession } from "../src/persist.js";

describe("P0-N native state mapping", () => {
  it("maps composer gates for consent, auth, offline, and empty draft", () => {
    const base = emptyState();
    expect(canSubmit(base).ok).toBe(false);
    expect(canSubmit({ ...base, draft: "Q" }).reason).toMatch(/sign in/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true }).reason).toMatch(/consent/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true, consentGranted: true, offline: true }).reason).toMatch(/offline/i);
    expect(canSubmit({ ...base, draft: "Q", signedIn: true, consentGranted: true }).ok).toBe(true);
  });

  it("persistSession then hydrateOnLaunch restores token, draft, and last run", async () => {
    const store = memoryStore();
    const s = applySnapshot(
      { ...emptyState(), draft: "Compare options in Germany", signedIn: true, consentGranted: true },
      { runId: "r1", lifecycle: "running", phase: "writing", outcome: null, reportId: null, labeledDemo: true },
    );
    s.report = {
      reportId: "rep-1",
      blocks: [{ id: "answer", kind: "text", text: "Vendor A", claimIds: ["c1"], citationIds: ["p1"] }],
      limitations: [],
      labeledDemo: true,
    };
    await persistSession(store, { token: "tok-session-1", state: s });
    const hydrated = await hydrateOnLaunch(store);
    expect(hydrated.token).toBe("tok-session-1");
    expect(hydrated.state.draft).toContain("Germany");
    expect(hydrated.state.run?.runId).toBe("r1");
    expect(hydrated.state.run?.phase).toBe("writing");
    expect(hydrated.state.report?.reportId).toBe("rep-1");
    expect(hydrated.state.consentGranted).toBe(true);
    expect(hydrated.state.source).toBeNull();
  });

  it("hydrateOnLaunch does not invent a session when persistSession never ran", async () => {
    const hydrated = await hydrateOnLaunch(memoryStore());
    expect(hydrated.token).toBeNull();
    expect(hydrated.state.draft).toBe("");
    expect(hydrated.state.run).toBeNull();
    expect(hydrated.state.report).toBeNull();
    expect(hydrated.state.signedIn).toBe(false);
  });

  it("openLibraryItem switches to research and binds the run before polling", () => {
    const next = openLibraryItem({ ...emptyState(), tab: "library" }, "run-library-1");
    expect(next.tab).toBe("research");
    expect(next.run?.runId).toBe("run-library-1");
    expect(next.status).toBe("progress");
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
