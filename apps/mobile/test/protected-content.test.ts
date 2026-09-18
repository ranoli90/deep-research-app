import { describe, expect, it, vi } from "vitest";
import { createProtectedContentStore } from "../src/protected-content";
import { createSessionStorage, type KeyValueStore } from "../src/persist";
import { emptyState } from "../src/state";
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const faults = { set: "", remove: "" };
  const store: KeyValueStore = {
    getItem: async k => data.get(k) ?? null,
    setItem: async (k, v) => { if (faults.set && k.endsWith(faults.set)) throw new Error("native unavailable"); data.set(k, v); },
    removeItem: async k => { if (faults.remove && k.endsWith(faults.remove)) throw new Error("native unavailable"); data.delete(k); },
  };
  return { store, data, faults };
}
const KEY = "deep.ui.v2";
describe("W03 protected native content cache", () => {
  it("stores large Unicode snapshots in bounded native values without plaintext copies", async () => {
    const plain = storage({ "deep.install.v2": "1" }), secure = storage();
    const cache = createProtectedContentStore(plain.store, secure.store);
    const text = JSON.stringify({ accountId: "owner", text: "Source Δ evidence 🙂 ".repeat(500) });
    await cache.setItem(KEY, text);
    expect(await cache.getItem(KEY)).toBe(text);
    expect([...plain.data.values()].join("")).not.toContain("Source");
    expect(plain.data.has(KEY)).toBe(false);
    for (const [key, value] of secure.data) if (/\.[01]\.\d+$/.test(key)) expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(1600);
  });
  it("migrates a legacy snapshot only after a protected commit, and never reads through a native failure", async () => {
    const plain = storage({ [KEY]: "private legacy", "deep.install.v2": "1" }), secure = storage();
    const cache = createProtectedContentStore(plain.store, secure.store);
    secure.faults.set = ".0.0";
    await expect(cache.getItem(KEY)).rejects.toThrow("native unavailable");
    expect(plain.data.get(KEY)).toBe("private legacy"); // Pending migration is not falsely reported protected.
    secure.faults.set = "";
    expect(await cache.getItem(KEY)).toBe("private legacy");
    expect(plain.data.has(KEY)).toBe(false);
  });
  it("retains the previous committed snapshot after an interrupted write and deletes allocated orphan chunks", async () => {
    const plain = storage(), secure = storage(), cache = createProtectedContentStore(plain.store, secure.store);
    await cache.setItem(KEY, "old snapshot");
    secure.faults.set = ".1.1";
    await expect(cache.setItem(KEY, "new snapshot".repeat(300))).rejects.toThrow("native unavailable");
    expect(await cache.getItem(KEY)).toBe("old snapshot");
    secure.faults.set = "";
    await cache.removeItem(KEY);
    expect(await cache.getItem(KEY)).toBeNull();
    expect(secure.data.size).toBe(0);
  });
  it("durably denies deleted content even if native deletion fails, then retries physical cleanup", async () => {
    const plain = storage(), secure = storage(), cache = createProtectedContentStore(plain.store, secure.store);
    await cache.setItem(KEY, "private");
    secure.faults.remove = ".0.0";
    await expect(cache.removeItem(KEY)).rejects.toThrow("native unavailable");
    expect(await createProtectedContentStore(plain.store, secure.store).getItem(KEY)).toBeNull();
    expect(secure.data.size).toBeGreaterThan(0);
    secure.faults.remove = ""; await cache.removeItem(KEY);
    expect(secure.data.size).toBe(0);
  });
  it("rejects missing committed chunks and corrupt manifests without falling back to plaintext", async () => {
    const plain = storage(), secure = storage(), cache = createProtectedContentStore(plain.store, secure.store);
    await cache.setItem(KEY, "private"); secure.data.delete(`${KEY}.content.v1.0.0`);
    plain.data.set(KEY, "untrusted fallback");
    await expect(cache.getItem(KEY)).rejects.toThrow("incomplete");
    secure.data.set(`${KEY}.content.v1`, JSON.stringify({ version: 1, active: 0, counts: [99999, 0] }));
    await expect(cache.getItem(KEY)).rejects.toThrow("Invalid protected");
  });
  it("revokes guest and owned keychain content when the install marker is absent", async () => {
    const plain = storage(), secure = storage(), cache = createProtectedContentStore(plain.store, secure.store);
    await cache.setItem(KEY, "owned"); await cache.setItem("deep.draft.guest", "guest");
    expect(await cache.getItem("deep.install.v2")).toBeNull();
    expect(await cache.getItem(KEY)).toBeNull(); expect(await cache.getItem("deep.draft.guest")).toBeNull();
    expect(secure.data.size).toBe(0);
  });
  it("preserves session account isolation and serialized logout using the protected adapter", async () => {
    const plain = storage({ "deep.install.v2": "1" }), secure = storage(), credentials = storage();
    const cache = createProtectedContentStore(plain.store, secure.store), sessions = createSessionStorage(cache, credentials.store);
    await sessions.activate({ accountId: "a", token: "a-token" });
    await sessions.persist({ token: "a-token", state: { ...emptyState(), signedIn: true, draft: "A private draft" } });
    const fresh = createSessionStorage(createProtectedContentStore(plain.store, secure.store), credentials.store);
    expect((await fresh.hydrate()).state.draft).toBe("A private draft");
    await sessions.activate({ accountId: "b", token: "b-token" });
    await sessions.persist({ token: "a-token", state: { ...emptyState(), draft: "late A" } });
    expect((await sessions.hydrate()).state.draft).toBe("");
    await sessions.clear(); expect(secure.data.size).toBe(0);
    expect([...plain.data.values()].join("")).not.toContain("private");
  });
  it("rejects oversized values before allocating secure content", async () => {
    const plain = storage(), secure = storage(), cache = createProtectedContentStore(plain.store, secure.store);
    await expect(cache.setItem(KEY, "x".repeat(2_000_001))).rejects.toThrow("too large");
    expect(secure.data.size).toBe(0);
  });
});
it("W03 coalesces queued snapshots and skips identical poll state without losing the newest draft", async () => {
  const plain = storage({ "deep.install.v2": "1" }), secure = storage(), credentials = storage();
  let writes = 0;
  const tracked: KeyValueStore = { ...secure.store, setItem: async (key, value) => { writes++; await secure.store.setItem(key, value); } };
  const sessions = createSessionStorage(createProtectedContentStore(plain.store, tracked), credentials.store);
  await sessions.activate({ accountId: "owner", token: "token" });
  const start = writes;
  await Promise.all(Array.from({ length: 40 }, (_, i) => sessions.persist({ token: "token", state: { ...emptyState(), draft: `latest ${i}` } })));
  expect(writes - start).toBe(3); // Allocation, one chunk, commit; queued obsolete snapshots did not hit native storage.
  const saved = writes;
  await sessions.persist({ token: "token", state: { ...emptyState(), draft: "latest 39", error: "network offline" } });
  expect(writes).toBe(saved); // Transient view state is not a new persisted snapshot.
  expect((await sessions.hydrate()).state.draft).toBe("latest 39");
});

it("W03 background flush commits the newest queued snapshot without waiting for the quiet period", async () => {
  const plain = storage({ "deep.install.v2": "1" }), secure = storage();
  const sessions = createSessionStorage(createProtectedContentStore(plain.store, secure.store), storage().store, "test-local", 150);
  await sessions.activate({ accountId: "owner", token: "token" });
  vi.useFakeTimers();
  try {
    const first = sessions.persist({ token: "token", state: { ...emptyState(), draft: "first" } });
    await Promise.resolve();
    const latest = sessions.persist({ token: "token", state: { ...emptyState(), draft: "latest" } });
    await sessions.flush();
    await Promise.all([first, latest]);
    expect((await sessions.hydrate()).state.draft).toBe("latest");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it("W03 background flush reports a failed native write instead of claiming the draft was saved", async () => {
  const plain = storage({ "deep.install.v2": "1" }), secure = storage();
  const sessions = createSessionStorage(createProtectedContentStore(plain.store, secure.store), storage().store, "test-local", 150);
  await sessions.activate({ accountId: "owner", token: "token" });
  secure.faults.set = ".0.0";
  const write = expect(sessions.persist({ token: "token", state: { ...emptyState(), draft: "unsaved" } })).rejects.toThrow("native unavailable");
  await expect(sessions.flush()).rejects.toThrow("native unavailable");
  await write;
});
