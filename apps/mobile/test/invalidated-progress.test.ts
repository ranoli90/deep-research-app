import { expect, it } from "vitest";
import { applyRemoteInvalidation, redactInvalidatedContent } from "../src/remote-invalidation";
import { createSessionStorage, memoryStore } from "../src/persist";
import { emptyState, openLibraryItem, researchActivity, type UiState } from "../src/state";
const runId = "592be93e-5060-4410-a802-af2ff6dfebfd";
const tombstone = { runId, lifecycle: "terminal", phase: "writing", outcome: "cancelled", reportId: null, labeledDemo: false, contentInvalidated: true };
it("library open does not invent in-progress research before the server snapshot", () => {
  const opened = openLibraryItem({ ...emptyState(), signedIn: true }, runId);
  expect(opened.run?.lifecycle).toBe("loading");
  expect(researchActivity(opened).inProgress).toBe(false);
});

it("W03/W07 reopening an invalidated Library run persists terminal status instead of invented progress", async () => {
  const cache = memoryStore(), credentials = memoryStore(), store = createSessionStorage(cache, credentials);
  await store.activate({ accountId: "synthetic", token: "synthetic" });
  let state: UiState = openLibraryItem({ ...emptyState(), signedIn: true, draft: "Keep this independent draft" }, runId);
  expect(state.status).toBe("loading");
  await applyRemoteInvalidation(state, tombstone, {
    current: () => true,
    hide: () => { state = redactInvalidatedContent({ ...state, run: tombstone }, runId); },
    save: (next, id) => store.redactRunContent("synthetic", id, next),
  });
  expect(state.status).toBe("cancelled");
  expect(researchActivity(state)).toEqual({ inProgress: false, terminalNotice: "This report is unavailable because a source was deleted." });
  const restored = (await createSessionStorage(cache, credentials).hydrate()).state;
  expect(restored.run?.lifecycle).toBe("terminal");
  expect(restored.status).toBe("cancelled");
  expect(restored.report).toBeNull();
  expect(restored.pendingContentInvalidation).toBeNull();
  expect(restored.draft).toBe("Keep this independent draft");
});

it.each(["completed", "completed_with_limitations", "cancelled", "failed"])("W07 terminal %s without report never offers progress or cancellation", outcome => {
  const state = { ...emptyState(), status: "progress" as const, run: { ...tombstone, contentInvalidated: false, outcome } };
  expect(researchActivity(state).inProgress).toBe(false);
  if (outcome === "cancelled") expect(researchActivity(state).terminalNotice).toBe("Research cancelled.");
  else if (outcome === "failed") expect(researchActivity(state).terminalNotice).toBe("Research failed.");
  else expect(researchActivity(state).terminalNotice).toContain("No report is available.");
});
it.each(["queued", "running", "cancelling", "awaiting_input"])("W07 actual %s work still shows progress", lifecycle => {
  expect(researchActivity({ ...emptyState(), run: { ...tombstone, lifecycle, outcome: null, contentInvalidated: false } }).inProgress).toBe(true);
});
it("W03 stale progress cache cannot imply activity for an invalidated run or incomplete cleanup", () => {
  const state = { ...emptyState(), status: "progress" as const, run: tombstone };
  expect(researchActivity(state).inProgress).toBe(false);
  expect(researchActivity({ ...state, pendingContentInvalidation: runId }).inProgress).toBe(false);
  const unbound: UiState = { ...emptyState(), status: "loading" };
  expect(researchActivity(unbound).inProgress).toBe(false);
});

it("W03 invalidated content does not claim an active server run has ended", () => {
  const state = { ...emptyState(), run: { ...tombstone, lifecycle: "cancelling", outcome: null } };
  expect(researchActivity(state)).toEqual({ inProgress: false, terminalNotice: "This report is unavailable because a source was deleted." });
});
it("W03 failed cleanup keeps the terminal invalidation visible without invented work", async () => {
  let state = openLibraryItem({ ...emptyState(), signedIn: true }, runId);
  await expect(applyRemoteInvalidation(state, tombstone, {
    current: () => true,
    hide: () => { state = redactInvalidatedContent({ ...state, run: tombstone }, runId); },
    save: async () => { throw new Error("storage unavailable"); },
  })).rejects.toThrow("storage unavailable");
  expect(state.status).toBe("cancelled");
  expect(state.pendingContentInvalidation).toBe(runId);
  expect(researchActivity(state).inProgress).toBe(false);
});
