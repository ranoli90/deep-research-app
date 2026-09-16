import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applySnapshot, canSubmit, conciseBlocks, emptyState, expireLocalSession, openLibraryItem } from "../src/state.js";
import { hydrateOnLaunch, memoryStore, persistSession } from "../src/persist.js";
import { ApiError, isExpiredSession } from "../src/api.js";

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
    expect(await store.getItem("deep.token")).toBe("tok-session-1");
    expect(await store.getItem("deep.draft")).toContain("Germany");
    expect(await store.getItem("deep.ui")).toMatch(/r1/);
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

  it("App.tsx calls persistSession, hydrateOnLaunch, and openLibraryItem", () => {
    const src = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(src).toMatch(/hydrateOnLaunch\(AsyncStorage\)/);
    expect(src).toMatch(/persistSession\(AsyncStorage/);
    expect(src).toMatch(/openLibraryItem\(s, id\)/);
    expect(src).toMatch(/api\.followUp/);
  });

  it("expired session keeps the draft and routes to settings", () => {
    const next = expireLocalSession({ ...emptyState(), draft: "Compare options in Germany", signedIn: true, report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true } });
    expect(next.draft).toContain("Germany");
    expect(next.signedIn).toBe(false);
    expect(next.report).toBeNull();
    expect(next.tab).toBe("settings");
    expect(next.error).toMatch(/expired/i);
    expect(isExpiredSession(new ApiError(401, "Sign in required."))).toBe(true);
    expect(isExpiredSession(new ApiError(403, "nope"))).toBe(false);
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
