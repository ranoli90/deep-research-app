import { expect, it, vi } from "vitest";
import { createSourceFocus } from "../src/source-focus";
import { emptyState, handleAndroidBack, type UiState } from "../src/state";
function setup() {
  const pending: (() => void)[] = [], focus = vi.fn();
  const control = createSourceFocus<object>(callback => pending.push(callback), focus);
  return { control, focus, flush: () => pending.splice(0).forEach(callback => callback()) };
}
it("A58 returns focus to the invoking citation after its reader remounts, once", () => {
  const x = setup(); x.control.view("account-a", "report-1", "reader-1");
  x.control.open("block-2:citation-3"); x.control.view("account-a", "report-1", "sheet");
  x.control.close(); const generation = x.control.view("account-a", "report-1", "reader-2"), node = {};
  x.control.register(generation, "other", {}, () => true);
  x.control.register(generation, "block-2:citation-3", node, () => true);
  x.control.register(generation, "block-2:citation-3", node, () => true);
  expect(x.focus).not.toHaveBeenCalled(); x.flush(); expect(x.focus).toHaveBeenCalledExactlyOnceWith(node);
});
it.each(["account", "report", "view", "unmount", "request"])("A57/A58 rejects pending focus after %s changes", change => {
  const x = setup(); x.control.view("a", "r", "sheet"); x.control.open("citation"); x.control.close();
  const generation = x.control.view("a", "r", "reader"); let current = true;
  x.control.register(generation, "citation", {}, () => current);
  if (change === "account") x.control.view("b", "r", "reader");
  if (change === "report") x.control.view("a", "new-report", "reader");
  if (change === "view") x.control.view("a", "r", "settings");
  if (change === "unmount") x.control.register(generation, "citation", null, () => true);
  if (change === "request") current = false;
  x.flush(); expect(x.focus).not.toHaveBeenCalled();
});
it("a late old ref cannot register or erase the new report's citation", () => {
  const x = setup(), old = x.control.view("a", "r", "reader");
  const next = x.control.view("b", "r", "reader"); x.control.open("citation"); x.control.close();
  const node = {}; x.control.register(next, "citation", node, () => true);
  x.control.register(old, "citation", null, () => true); x.flush(); expect(x.focus).toHaveBeenCalledExactlyOnceWith(node);
});
it("Android Back consumes a source close immediately without waiting for React", () => {
  const source = { passageId: "p", title: "Source", exactText: "Evidence", accessLevel: "full-text" };
  const update = vi.fn(), close = vi.fn();
  expect(handleAndroidBack({ ...emptyState(), source }, update, close)).toBe(true);
  expect(close).toHaveBeenCalledOnce(); expect(update).not.toHaveBeenCalled();
});
it("Android Back consumes tab navigation even when its updater is deferred", () => {
  let deferred: ((state: UiState) => UiState) | undefined; const close = vi.fn();
  const state = { ...emptyState(), tab: "library" as const };
  expect(handleAndroidBack(state, updater => { deferred = updater; }, close)).toBe(true);
  expect(state.tab).toBe("library"); expect(deferred!(state).tab).toBe("research");
  expect(handleAndroidBack(emptyState(), vi.fn(), close)).toBe(true);
});
