import { expect, it } from "vitest";
import { createSessionStorage, memoryStore } from "../src/persist.js";
import { emptyState } from "../src/state.js";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const privateState = (draft: string) => ({ ...emptyState(), signedIn: true, draft,
  report: { reportId: draft, blocks: [], limitations: [], labeledDemo: true } });

it("W03 credentials never enter the content store; an unscoped legacy token cannot restore authentication", async () => {
  const cache = memoryStore({ "deep.token": "legacy-secret", "deep.ui": JSON.stringify(privateState("old-private")) });
  const credentials = memoryStore(); const store = createSessionStorage(cache, credentials);
  expect((await store.hydrate()).token).toBeNull();
  expect(await cache.getItem("deep.token")).toBeNull(); expect(await cache.getItem("deep.ui")).toBeNull();
  await store.activate({ accountId: "a", token: "secure-secret" });
  await store.persist({ token: "secure-secret", state: privateState("private-A") });
  expect(await credentials.getItem("deep.session.v2")).toContain("secure-secret");
  expect(await cache.getItem("deep.ui.v2")).toContain("private-A");
  expect(await cache.getItem("deep.ui.v2")).not.toContain("secure-secret");
});

it("W03 logout waits behind an in-flight write and no queued or late write can restore account content", async () => {
  const cache = memoryStore(), credentials = memoryStore(), entered = deferred(), release = deferred();
  const store = createSessionStorage({ ...cache, setItem: async (key, value) => {
    if (key === "deep.ui.v2") { entered.resolve(); await release.promise; } await cache.setItem(key, value);
  } }, credentials);
  await store.activate({ accountId: "a", token: "token-a" });
  const writing = store.persist({ token: "token-a", state: privateState("private-A") });
  await entered.promise;
  const queued = store.persist({ token: "token-a", state: privateState("queued-private-A") });
  const logout = store.clear(); release.resolve();
  await Promise.all([writing, queued, logout]);
  await store.persist({ token: "token-a", state: privateState("late-private-A") });
  expect(await cache.getItem("deep.ui.v2")).toBeNull();
  expect(await credentials.getItem("deep.session.v2")).toBeNull();
  expect((await createSessionStorage(cache, credentials).hydrate()).state.report).toBeNull();
});

it("W03 account switching cannot bind an old cached snapshot to a new credential", async () => {
  const cache = memoryStore(), credentials = memoryStore(), store = createSessionStorage(cache, credentials);
  await store.activate({ accountId: "a", token: "a" });
  await store.persist({ token: "a", state: privateState("private-A") });
  const oldSnapshot = await cache.getItem("deep.ui.v2");
  await store.activate({ accountId: "b", token: "b" });
  await cache.setItem("deep.ui.v2", oldSnapshot!); // Simulate a corrupted/restored cache from a different owner.
  const restored = await createSessionStorage(cache, credentials).hydrate();
  expect(restored.accountId).toBe("b"); expect(restored.state.report).toBeNull(); expect(restored.state.draft).toBe("");
  await store.persist({ token: "a", state: privateState("late-A") });
  await store.persist({ token: "b", state: privateState("private-B") });
  expect((await store.hydrate()).state.draft).toBe("private-B");
});

it("W03 a failed secure deletion cannot silently restore the old session on reopen", async () => {
  const cache = memoryStore(), secure = memoryStore();
  let failDelete = false;
  const credentials = { ...secure, removeItem: async (key: string) => { if (failDelete) throw new Error("device locked"); await secure.removeItem(key); } };
  const store = createSessionStorage(cache, credentials);
  await store.activate({ accountId: "a", token: "a" });
  await store.persist({ token: "a", state: privateState("private-A") });
  failDelete = true;
  await expect(store.clear()).rejects.toThrow("Could not finish clearing");
  expect((await createSessionStorage(cache, credentials).hydrate()).token).toBeNull();
  expect(await cache.getItem("deep.ui.v2")).toBeNull();
});

it("W03 secure storage failure does not fall back to plaintext or revive the prior account", async () => {
  const cache = memoryStore(), secure = memoryStore(); let failWrite = false;
  const store = createSessionStorage(cache, { ...secure, setItem: async (key, value) => {
    if (failWrite) throw new Error("native credential store unavailable"); await secure.setItem(key, value);
  } });
  await store.activate({ accountId: "a", token: "a" }); await store.persist({ token: "a", state: privateState("private-A") });
  failWrite = true;
  await expect(store.activate({ accountId: "b", token: "private-token-B" })).rejects.toThrow("native credential");
  expect(await cache.getItem("deep.token")).toBeNull(); expect(await cache.getItem("deep.ui.v2")).toBeNull();
  expect((await store.hydrate()).token).toBeNull();
});

it("W03 a keychain credential surviving reinstall cannot restore account data without this installation marker", async () => {
  const secure = memoryStore({ "deep.session.v2": JSON.stringify({ accountId: "a", token: "surviving-token" }) });
  const restored = await createSessionStorage(memoryStore(), secure).hydrate();
  expect(restored.token).toBeNull(); expect(await secure.getItem("deep.session.v2")).toBeNull();
});

it("W03 malformed or falsely signed-in cached state cannot manufacture a session", async () => {
  const cache = memoryStore({ "deep.install.v2": "1", "deep.ui.v2": JSON.stringify({ accountId: "a", state: privateState("private") }) });
  const restored = await createSessionStorage(cache, memoryStore()).hydrate();
  expect(restored.state.signedIn).toBe(false); expect(restored.state.report).toBeNull(); expect(await cache.getItem("deep.ui.v2")).toBeNull();
});

it("W03 changing backend configuration cannot forward a prior project's token or cached data", async () => {
  const cache = memoryStore(), credentials = memoryStore();
  const first = createSessionStorage(cache, credentials, "https://project-a.example");
  await first.activate({ accountId: "a", token: "a" }); await first.persist({ token: "a", state: privateState("private-A") });
  const other = await createSessionStorage(cache, credentials, "https://project-b.example").hydrate();
  expect(other.token).toBeNull(); expect(other.state.report).toBeNull(); expect(await credentials.getItem("deep.session.v2")).toBeNull();
});


it("W03 failed revocation-marker storage still attempts credential and private-content deletion", async () => {
  const cache = memoryStore(), credentials = memoryStore(); let failMarker = false;
  const store = createSessionStorage({ ...cache, setItem: async (key, value) => {
    if (failMarker && key === "deep.session.revoked") throw new Error("cache unavailable");
    await cache.setItem(key, value);
  } }, credentials);
  await store.activate({ accountId: "a", token: "a" });
  await store.persist({ token: "a", state: privateState("private-A") });
  failMarker = true;
  await expect(store.clear()).rejects.toThrow("Could not finish clearing");
  expect(await credentials.getItem("deep.session.v2")).toBeNull();
  expect(await cache.getItem("deep.ui.v2")).toBeNull();
  expect((await createSessionStorage(cache, credentials).hydrate()).token).toBeNull();
});
