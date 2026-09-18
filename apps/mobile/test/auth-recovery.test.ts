import { readFileSync } from "node:fs";
import ts from "typescript";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { emptyState, type UiState } from "../src/state";
import { expireLocalSession } from "../src/state";
import { applyRemoteInvalidation, redactInvalidatedContent } from "../src/remote-invalidation";
import { SupersededRequest } from "../src/request-scope";
// Execute the actual App closure against controlled boundaries; do not copy its logic.
function appFunction(name: string, bindings: Record<string, unknown>): (...args: unknown[]) => Promise<unknown> {
  const source = ts.createSourceFile("App.tsx", readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); }
  visit(source);
  if (!declaration) throw Error("App function missing");
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(bindings), compiled + `;return ${name};`)(...Object.values(bindings));
}
function recovery(clear: () => Promise<void>) {
  let state: UiState = { ...emptyState(), signedIn: true, draft: "private" }, ready = true, current = true;
  const release = vi.fn();
  const bindings = { redactingContent: { current: true }, stopPolling: vi.fn(), api: { activateSession: vi.fn(), capture: () => ({ current: () => current, release }) }, clearPanels: vi.fn(), setToken: vi.fn(), setState: (change: (s: UiState) => UiState) => { state = change(state); }, expireLocalSession, clearAccountLocal: clear, sessionStorage: {}, setStorageReady: (value: boolean) => { ready = value; } };
  return { run: appFunction("onAuthFailure", bindings), state: () => state, ready: () => ready, supersede: () => { current = false; }, release };
}
it("W03 expired-session cleanup blocks sign-in while pending and restores it only after durable success", async () => {
  let resolve!: () => void;
  const control = recovery(() => new Promise<void>(done => { resolve = done; }));
  const pending = control.run();
  expect(control.ready()).toBe(false);
  expect(control.state().signedIn).toBe(false);
  expect(control.state().draft).toBe("");
  resolve(); await pending;
  expect(control.ready()).toBe(true);
});
it("W03 failed expired-session cleanup keeps sign-in closed and shows recovery error", async () => {
  const control = recovery(async () => { throw Error("keychain unavailable"); });
  await control.run();
  expect(control.ready()).toBe(false);
  expect(control.state().error).toContain("Device cleanup failed");
});
it("W03 superseded cleanup cannot unlock or overwrite another session", async () => {
  let resolve!: () => void;
  const control = recovery(() => new Promise<void>(done => { resolve = done; }));
  const pending = control.run(); control.supersede(); resolve(); await pending;
  expect(control.ready()).toBe(false);
});
it.each([{ hydrated: false, message: "Restoring" }, { hydrated: true, message: "Device recovery failed" }])("W07 sign-in readiness denial is visible without admitting a session ($hydrated)", async ({ hydrated, message }) => {
  let state = emptyState(); const session = vi.fn();
  const run = appFunction("startSession", { token: null, hydrated, storageReady: false, api: { session }, isSupersededRequest: () => false, setState: (change: (s: UiState) => UiState) => { state = change(state); } });
  await expect(run()).rejects.toThrow(message);
  expect(session).not.toHaveBeenCalled();
  expect(state.error).toContain(message);
  expect(state.tab).toBe("settings");
});

it("W03/W07 successful invalidated-run refresh clears stale offline state without clearing privacy notice", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const snapshot = { runId, lifecycle: "terminal", phase: "writing", outcome: "cancelled", reportId: null, labeledDemo: false, contentInvalidated: true };
  let state: UiState = { ...emptyState(), signedIn: true, offline: true, run: snapshot, report: { reportId: "old-report", blocks: [], limitations: [], labeledDemo: false } };
  const events = vi.fn(), report = vi.fn(), redactRunContent = vi.fn(async () => undefined);
  const guard = { current: () => true, release: vi.fn() };
  const run = appFunction("refreshRun", {
    api: { currentRun: () => true, captureView: () => guard, getRun: async () => snapshot, invalidateView: vi.fn(), events, report },
    refreshing: { current: new Map() }, latestUi: { current: state }, redactingContent: { current: false },
    setViewState: (change: (s: UiState) => UiState) => { state = change(state); },
    setStorageReady: vi.fn(), setCorrectionSelection: vi.fn(), stopPolling: vi.fn(), sessionStorage: { redactRunContent },
    applyRemoteInvalidation, redactInvalidatedContent, SupersededRequest, isSupersededRequest: (error: unknown) => error instanceof SupersededRequest,
  });
  await run("owned-session", runId);
  expect(redactRunContent).toHaveBeenCalledOnce();
  expect(state.offline).toBe(false);
  expect(state.report).toBeNull();
  expect(state.pendingContentInvalidation).toBeNull();
  expect(state.error).toContain("deleted source");
  expect(events).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
});
