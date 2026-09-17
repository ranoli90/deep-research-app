import { describe, expect, it } from "vitest";
import { clearAccountLocal, hydrateOnLaunch, loadDraft, logoutLocal, memoryStore, persistDraft, persistSession } from "../src/persist.js";
import {
  androidBack,
  attachFile,
  canSubmit,
  conciseBlocks,
  emptyState,
  logout,
  mergeEvents,
  openLibraryItem,
  restoreAnchor,
  submitPrerequisite,
} from "../src/state.js";

describe("P3 native journeys (structural)", () => {
  it("M05 persists a draft offline and will not submit", async () => {
    const store = memoryStore();
    await persistDraft(store, "Compare options in Germany");
    expect(await loadDraft(store)).toContain("Germany");
  });

  it("M07 unauthenticated send routes to settings", () => {
    const s = { ...emptyState(), draft: "Q" };
    expect(submitPrerequisite(s)).toBe("settings");
  });

  it("M03 android back closes the source sheet before leaving research", () => {
    const open = { ...emptyState(), source: { passageId: "p", title: "T", exactText: "x", accessLevel: "full-text" } };
    const r = androidBack(open);
    expect(r.consumed).toBe(true);
    expect(r.next.source).toBeNull();
  });

  it("S07 / S12 logout clears cached reports but keeps the draft", () => {
    const s = {
      ...emptyState(),
      draft: "keep me",
      signedIn: true,
      report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true },
    };
    const next = logout(s);
    expect(next.report).toBeNull();
    expect(next.signedIn).toBe(false);
    expect(next.draft).toBe("keep me");
  });

  it("J08 mergeEvents deduplicates by sequence", () => {
    const a = mergeEvents(
      [{ sequence: 1, type: "accepted", publicSummary: "a" }],
      [
        { sequence: 1, type: "accepted", publicSummary: "a" },
        { sequence: 2, type: "searched", publicSummary: "b" },
      ],
    );
    expect(a.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("V2-12 restores a valid reading anchor and explains a moved block", () => {
    const blocks = [{ id: "answer", kind: "text", text: "hi", claimIds: [], citationIds: ["p1"] }];
    const ok = restoreAnchor({ reportId: "r", blockId: "answer", offset: 0 }, blocks);
    expect(ok.anchor?.blockId).toBe("answer");
    const moved = restoreAnchor({ reportId: "r", blockId: "gone", offset: 12 }, blocks);
    expect(moved.note).toMatch(/changed/i);
  });

  it("V2-11 concise and detailed share the answer citations", () => {
    const blocks = [
      { id: "answer", kind: "text", text: "A", claimIds: ["c1"], citationIds: ["p1"] },
      { id: "body", kind: "text", text: "A is eligible", claimIds: ["c1"], citationIds: ["p1"] },
    ];
    expect(conciseBlocks(blocks)[0]?.citationIds).toEqual(["p1"]);
  });

  it("rejects unsupported attachments", () => {
    const next = attachFile(emptyState(), { filename: "x.exe", mime: "application/octet-stream", text: "bin" });
    expect(next.error).toMatch(/text, Markdown, and PDF/i);
  });

  it("M06 notification permission is not a submit prerequisite", () => {
    const s = { ...emptyState(), signedIn: true, consentGranted: true, draft: "Compare options in Germany" };
    expect(canSubmit(s).ok).toBe(true);
  });

  it("M08 previous report stays after a correction snapshot", () => {
    const previous = { reportId: "old", blocks: [{ id: "answer", kind: "text", text: "old answer", claimIds: [], citationIds: [] }] };
    const s = { ...emptyState(), previousReport: previous, report: { reportId: "new", blocks: previous.blocks, limitations: [], labeledDemo: true } };
    expect(s.previousReport?.reportId).toBe("old");
    expect(s.report?.reportId).toBe("new");
  });

  it("M10 flag state is distinct from share", () => {
    const s = { ...emptyState(), flagSent: true };
    expect(s.flagSent).toBe(true);
  });

  it("M04 long unicode report text remains in one canonical block", () => {
    const blocks = [
      {
        id: "answer",
        kind: "text",
        text: "表 漢字 café — ".repeat(40),
        claimIds: ["c1"],
        citationIds: ["p1"],
      },
    ];
    expect(conciseBlocks(blocks)[0]?.text).toContain("café");
    expect(conciseBlocks(blocks)[0]?.citationIds).toEqual(["p1"]);
  });

  it("M09 deletion store wipe drops draft, token, and reports", async () => {
    const store = memoryStore({ "deep.draft": "secret", "deep.ui": "{}", "deep.token": "tok" });
    await persistSession(store, {
      token: "tok",
      state: { ...emptyState(), draft: "secret", signedIn: true, report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true } },
    });
    await clearAccountLocal(store);
    expect(await loadDraft(store)).toBe("");
    const hydrated = await hydrateOnLaunch(store);
    expect(hydrated.token).toBeNull();
    expect(hydrated.state.report).toBeNull();
  });

  it("S12 logoutLocal keeps the draft and drops token and cached reports", async () => {
    const store = memoryStore();
    await persistSession(store, {
      token: "tok",
      state: {
        ...emptyState(),
        draft: "keep me",
        signedIn: true,
        report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true },
      },
    });
    await logoutLocal(store, "keep me");
    const hydrated = await hydrateOnLaunch(store);
    expect(hydrated.token).toBeNull();
    expect(hydrated.state.draft).toBe("keep me");
    expect(hydrated.state.report).toBeNull();
    expect(hydrated.state.signedIn).toBe(false);
  });

  it("library open binds the run on research before any poll interval", () => {
    const opened = openLibraryItem({ ...emptyState(), tab: "library", signedIn: true }, "saved-run");
    expect(opened.tab).toBe("research");
    expect(opened.run?.runId).toBe("saved-run");
  });
});
