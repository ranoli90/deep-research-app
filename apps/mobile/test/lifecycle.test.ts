import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applySnapshot, canSubmit, conciseBlocks, emptyState, expireLocalSession, openLibraryItem } from "../src/state.js";
import { hydrateOnLaunch, memoryStore, persistSession } from "../src/persist.js";
import { ApiError, isExpiredSession, isOfflineError } from "../src/api.js";

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
    s.readingAnchor = { reportId: "rep-1", blockId: "eligibility", offset: 0 };
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
    expect(hydrated.state.status).toBe("completed");
    expect(hydrated.state.readingAnchor?.blockId).toBe("eligibility");
  });

  it("persistSession with a null token does not wipe a stored session token", async () => {
    const store = memoryStore();
    const s = { ...emptyState(), draft: "Compare options in Germany", signedIn: true };
    await persistSession(store, { token: "tok-session-1", state: s });
    await persistSession(store, { token: null, state: { ...s, draft: "still Germany" } });
    expect(await store.getItem("deep.token")).toBe("tok-session-1");
    const hydrated = await hydrateOnLaunch(store);
    expect(hydrated.token).toBe("tok-session-1");
    expect(hydrated.state.draft).toContain("Germany");
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
    expect(src).not.toMatch(/clarifyAnswer\.trim\(\)\s*\|\|\s*"Germany"/);
    expect(src).toMatch(/Enter a jurisdiction/);
    expect(src).toMatch(/api\.followUp/);
    expect(src).toMatch(/logoutLocal\(AsyncStorage/);
    expect(src).toMatch(/stopPolling\(\)/);
    expect(src).toMatch(/if \(!s\.signedIn\) return s;/);
    expect(src).toMatch(/Linking\.openURL\(deletionPageUrl\)/);
    expect(src).toMatch(/api\.settings\(token\)/);
    expect(src).toMatch(/Processor disclosures/);
    expect(src).toMatch(/Report generated output/);
    expect(src).toMatch(/Include report excerpt/);
    expect(src).toMatch(/Submit generated-output report/);
    expect(src).toMatch(/Restore purchases/);
    expect(src).toMatch(/api\.restorePurchases/);
    expect(src).toMatch(/Privacy data flows/);
    expect(src).toMatch(/Open web deletion page/);
    expect(src).toMatch(/state\.report \|\| state\.status === "completed"/);
    expect(src).toMatch(/api\.correct/);
    expect(src).toMatch(/Write a correction first/);
    expect(src).toMatch(/startPolling\(token, child\.runId\)/);
    expect(src).toMatch(/restoreAnchor/);
    expect(src).toMatch(/scrollTo/);
    expect(src).toMatch(/restoreReadingPosition/);
    expect(src).toMatch(/tab === "research" && !state\.source \? \(\s*<ScrollView/);
  });

  it("App.tsx labels composer, progress, report, source sheet, library, and settings", () => {
    const src = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    for (const label of [
      'accessibilityLabel="Research question"',
      'accessibilityLabel="Start research"',
      'accessibilityLabel="Research progress"',
      'accessibilityLabel="Cancel research"',
      'accessibilityLabel="In progress"',
      'accessibilityLabel="Research report"',
      'accessibilityLabel="Source sheet"',
      'accessibilityLabel="Close source sheet"',
      'accessibilityLabel="Saved reports"',
      'accessibilityLabel="Settings"',
      'accessibilityLabel="Correction"',
    ]) {
      expect(src).toContain(label);
    }
    expect(src).toMatch(/tab === "research" \? "Research"/);
    expect(src).toMatch(/tab === "library" \? "Library"/);
    expect(src).toMatch(/Keyboard\.addListener/);
    expect(src).toMatch(/announceForAccessibility/);
    expect(src).toMatch(/state\.tab === "research" && !state\.source/);
    expect(src).toMatch(/!keyboardOpen/);
    expect(src).not.toMatch(/allowFontScaling=\{false\}/);
    expect(src).toMatch(/maxFontSizeMultiplier=\{2\}/);
    expect(src).toMatch(/maxHeight: 180/);
    expect(src).toMatch(/isOfflineError/);
    expect(src).toMatch(/AppState\.addEventListener/);
    expect(src).toMatch(/onContinueClarification/);
    expect(src).toMatch(/api\.continueRun/);
    expect(src).toMatch(/report: null/);
    expect(src).toMatch(/attachments: \[\]/);
  });

  it("M05 network failures are offline errors and block submit without dropping the draft", () => {
    expect(isOfflineError(new ApiError(0, "The API did not respond. Check the connection."))).toBe(true);
    expect(isOfflineError(new ApiError(500, "server"))).toBe(false);
    const s = { ...emptyState(), draft: "Compare options in Germany", signedIn: true, consentGranted: true, offline: true };
    expect(canSubmit(s).ok).toBe(false);
    expect(canSubmit(s).reason).toMatch(/offline/i);
    expect(s.draft).toContain("Germany");
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

  it("concise view keeps eligibility after a 120 EUR constraint correction", () => {
    const blocks = [
      { id: "answer", kind: "text", text: "Vendor A at 40 EUR.", claimIds: ["c1"], citationIds: ["p1"] },
      {
        id: "constraints",
        kind: "text",
        text: "Applied supplied constraints: geography=germany; budget=120 EUR.",
        claimIds: [],
        citationIds: [],
      },
      {
        id: "eligibility",
        kind: "text",
        text: "Eligible: Vendor A, Vendor C. Discovery: open (reopened after constraint change).",
        claimIds: [],
        citationIds: ["p2"],
      },
      { id: "independence", kind: "text", text: "Four origin clusters.", claimIds: [], citationIds: [] },
    ];
    const concise = conciseBlocks(blocks);
    expect(concise.map((b) => b.id)).toEqual(["answer", "constraints", "eligibility"]);
    expect(JSON.stringify(concise)).toMatch(/Vendor C/);
    expect(JSON.stringify(concise)).toMatch(/120 EUR/);
    expect(concise.some((b) => b.id === "independence")).toBe(false);
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
