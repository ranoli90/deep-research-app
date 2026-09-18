import { describe, expect, it } from "vitest";
import { activeCorrectionDraft, editCorrectionDraft, parseCorrectionDraft, rebaseCorrectionDraft } from "../src/correction-draft";
import { createSessionStorage, memoryStore } from "../src/persist";
import { createProtectedContentStore } from "../src/protected-content";
import { applySnapshot, emptyState, logout, openLibraryItem, type UiState } from "../src/state";
function parent(): UiState {
  return { ...emptyState(), signedIn: true, status: "completed", routeMode: "controlled-research",
    run: { runId: "parent", lifecycle: "terminal", phase: "completed", outcome: "completed", reportId: "report",
      labeledDemo: false, correctionMode: "replace_question", correctionReserveMicro: 100000,
      brief: { originalQuestion: "Compare reef restoration methods", constraints: [], revision: 1 } },
    report: { reportId: "report", blocks: [{ id: "finding", kind: "text", text: "An existing finding", claimIds: [], citationIds: [] }], limitations: [], labeledDemo: false } };
}
describe("W06/W07 correction draft recovery", () => {
  it("restores question, source policy and exact revision through the protected session cache", async () => {
    const ordinary = memoryStore(), secure = memoryStore(), credentials = memoryStore();
    const store = createSessionStorage(createProtectedContentStore(ordinary, secure), credentials);
    await store.activate({ accountId: "owner", token: "token" });
    const state = editCorrectionDraft(parent(), "parent", 1, { question: "Compare reef restoration in colder water", evidencePolicy: "refresh" });
    await store.persist({ token: "token", state });
    const reopened = await createSessionStorage(createProtectedContentStore(ordinary, secure), credentials).hydrate();
    expect(reopened.state.correctionDraft).toEqual(state.correctionDraft);
    expect(activeCorrectionDraft(reopened.state)).toMatchObject({ runId: "parent", baseRevision: 1, evidencePolicy: "refresh" });
    expect(reopened.state.report?.reportId).toBe("report");
    expect(await ordinary.getItem("deep.ui.v2")).toBeNull();
  });
  it("retains the draft when browsing another run but never applies it to that run", () => {
    const edited = editCorrectionDraft(parent(), "parent", 1, { question: "A pending correction" });
    const other = openLibraryItem(edited, "other");
    expect(activeCorrectionDraft(other)).toBeNull();
    const reopened = applySnapshot(openLibraryItem(other, "parent"), parent().run!);
    expect(activeCorrectionDraft(reopened)?.question).toBe("A pending correction");
    expect(editCorrectionDraft(other, "parent", 1, { question: "late input" })).toBe(other);
  });
  it("preserves stale text and its basis until the user explicitly reviews the new revision", () => {
    const edited = editCorrectionDraft(parent(), "parent", 1, { question: "Saved constraint", evidencePolicy: "refresh" });
    const changed = applySnapshot(edited, { ...parent().run!, brief: { originalQuestion: "Changed server question", constraints: [], revision: 2 } });
    expect(activeCorrectionDraft(changed)).toMatchObject({ question: "Saved constraint", baseRevision: 1 });
    expect(editCorrectionDraft(changed, "parent", 1, { question: "old-render event" })).toBe(changed);
    const stillStale = editCorrectionDraft(changed, "parent", 2, { question: "Reviewed wording" });
    expect(stillStale.correctionDraft?.baseRevision).toBe(1);
    expect(rebaseCorrectionDraft(stillStale, "other", 2)).toBe(stillStale);
    expect(rebaseCorrectionDraft(stillStale, "parent", 2).correctionDraft).toMatchObject({ question: "Reviewed wording", baseRevision: 2, evidencePolicy: "refresh" });
  });
  it("clears correction content on account change/logout and rejects a late old-account write", async () => {
    const ordinary = memoryStore(), secure = memoryStore(), credentials = memoryStore();
    const store = createSessionStorage(createProtectedContentStore(ordinary, secure), credentials);
    await store.activate({ accountId: "a", token: "a" });
    const state = editCorrectionDraft(parent(), "parent", 1, { question: "A private correction" });
    await store.persist({ token: "a", state });
    await store.activate({ accountId: "b", token: "b" });
    await store.persist({ token: "a", state });
    expect((await store.hydrate()).state.correctionDraft).toBeNull();
    expect(logout(state).correctionDraft).toBeNull();
    expect(editCorrectionDraft({ ...parent(), signedIn: false }, "parent", 1, { question: "guest" }).correctionDraft).toBeNull();
  });
  it("rejects malformed draft metadata without discarding a valid saved report", async () => {
    const cache = memoryStore(), credentials = memoryStore(), store = createSessionStorage(cache, credentials);
    await store.activate({ accountId: "owner", token: "token" });
    await store.persist({ token: "token", state: parent() });
    const valid = { version: "correction-draft.v1", runId: "parent", baseRevision: 1, question: "Correction", evidencePolicy: "reuse_snapshot" };
    for (const patch of [{ version: "unknown" }, { baseRevision: 0 }, { baseRevision: 1.5 }, { question: "x".repeat(20001) }, { evidencePolicy: "silently_reuse" }, { accountId: "forged" }]) {
      const bad = { ...valid, ...patch };
      expect(parseCorrectionDraft(bad)).toBeNull();
      const payload = JSON.parse((await cache.getItem("deep.ui.v2"))!); payload.state.correctionDraft = bad;
      await cache.setItem("deep.ui.v2", JSON.stringify(payload));
      const state = (await createSessionStorage(cache, credentials).hydrate()).state;
      expect(state.correctionDraft).toBeNull(); expect(state.report?.reportId).toBe("report");
    }
  });
  it("hydrates older snapshots that predate correction drafts", async () => {
    const cache = memoryStore(), credentials = memoryStore(), store = createSessionStorage(cache, credentials);
    await store.activate({ accountId: "owner", token: "token" }); await store.persist({ token: "token", state: parent() });
    const payload = JSON.parse((await cache.getItem("deep.ui.v2"))!); delete payload.state.correctionDraft;
    await cache.setItem("deep.ui.v2", JSON.stringify(payload));
    const state = (await createSessionStorage(cache, credentials).hydrate()).state;
    expect(state.correctionDraft).toBeNull(); expect(state.report?.reportId).toBe("report");
  });
});
