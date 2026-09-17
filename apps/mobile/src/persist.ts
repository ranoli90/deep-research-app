import { emptyState, restoreAfterReopen, type UiState } from "./state";

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export type LocalSession = { accountId: string; token: string };
export type PersistedSession = { token: string | null; state: UiState };
const SESSION_KEY = "deep.session.v2", REVOKED_KEY = "deep.session.revoked", GUEST_KEY = "deep.draft.guest";
const SNAPSHOT_KEY = "deep.ui.v2", INSTALL_KEY = "deep.install.v2";
const legacyKeys = ["deep.token", "deep.ui", "deep.draft"];

function storedState(state: UiState) {
  const { draft, run, report, previousReport, readingAnchor, routeMode, consentGranted, status } = state;
  return { draft, run, report, previousReport, readingAnchor, routeMode, consentGranted, status };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((s) => typeof s === "string"); }
function blocks(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 2000 && value.every((b) => record(b) &&
    [b.id, b.kind, b.text].every((s) => typeof s === "string") && strings(b.claimIds) && strings(b.citationIds));
}
function parseState(raw: string | null, accountId: string): UiState | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!record(envelope) || envelope.accountId !== accountId || !record(envelope.state)) return null;
    const s = envelope.state;
    if (typeof s.draft !== "string" || typeof s.consentGranted !== "boolean" ||
      !["fixture", "controlled-research"].includes(String(s.routeMode)) ||
      !["empty", "loading", "progress", "completed", "partial", "failed", "cancelled", "awaiting_input"].includes(String(s.status))) return null;
    if (s.run !== null && (!record(s.run) || ![s.run.runId, s.run.lifecycle, s.run.phase].every((v) => typeof v === "string") ||
      typeof s.run.labeledDemo !== "boolean" || !(s.run.reportId === null || typeof s.run.reportId === "string"))) return null;
    if (s.report !== null && (!record(s.report) || typeof s.report.reportId !== "string" || !blocks(s.report.blocks) ||
      !strings(s.report.limitations) || typeof s.report.labeledDemo !== "boolean")) return null;
    if (s.previousReport !== null && (!record(s.previousReport) || typeof s.previousReport.reportId !== "string" || !blocks(s.previousReport.blocks))) return null;
    if (s.readingAnchor !== null && (!record(s.readingAnchor) || typeof s.readingAnchor.reportId !== "string" ||
      typeof s.readingAnchor.blockId !== "string" || typeof s.readingAnchor.offset !== "number" || !Number.isFinite(s.readingAnchor.offset))) return null;
    return { ...emptyState(), ...storedState(s as unknown as UiState), signedIn: true };
  } catch { return null; }
}

/** Credentials and content use separate stores. Only explicit activation may write a credential. */
export function createSessionStorage(cache: KeyValueStore, credentials: KeyValueStore, backend = "test-local") {
  let epoch = 0, current: LocalSession | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const operation = tail.then(fn, fn);
    tail = operation.catch(() => undefined);
    return operation;
  }
  async function removeLegacy() { for (const key of legacyKeys) await cache.removeItem(key); }
  return {
    cache, credentials,
    activate(session: LocalSession): Promise<void> {
      if (!session.accountId || !session.token) return Promise.reject(new Error("Invalid local session."));
      const version = ++epoch, previous = current;
      current = { ...session };
      return enqueue(async () => {
        if (version !== epoch) return;
        try {
          await cache.setItem(INSTALL_KEY, "1");
          await cache.setItem(REVOKED_KEY, "1");
          if (previous?.accountId !== session.accountId) {
            await cache.removeItem(SNAPSHOT_KEY);
            await credentials.removeItem(SESSION_KEY);
          }
          await cache.removeItem(GUEST_KEY);
          await credentials.setItem(SESSION_KEY, JSON.stringify({ ...session, backend }));
          await removeLegacy();
          if (version === epoch) await cache.removeItem(REVOKED_KEY);
        } catch (error) {
          if (version === epoch) { epoch++; current = null; }
          throw error;
        }
      });
    },
    persist(session: PersistedSession): Promise<void> {
      const version = epoch, owner = current;
      if (session.token !== (owner?.token ?? null)) return Promise.resolve();
      const payload = JSON.stringify(owner ? { accountId: owner.accountId, state: storedState(session.state) } : session.state.draft);
      return enqueue(async () => {
        if (version !== epoch || current?.token !== owner?.token) return;
        await cache.setItem(owner ? SNAPSHOT_KEY : GUEST_KEY, payload);
      });
    },
    hydrate(): Promise<{ token: string | null; accountId: string | null; state: UiState }> {
      const version = epoch;
      return enqueue(async () => {
        if (!await cache.getItem(INSTALL_KEY)) {
          await credentials.removeItem(SESSION_KEY);
          await cache.removeItem(SNAPSHOT_KEY);
          await cache.setItem(INSTALL_KEY, "1");
        }
        await removeLegacy(); // Unscoped legacy credentials/cache are deliberately not trusted or migrated.
        const raw = await credentials.getItem(SESSION_KEY);
        let session: LocalSession | null = null;
        try {
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          if (record(parsed) && parsed.backend === backend && typeof parsed.accountId === "string" && parsed.accountId && typeof parsed.token === "string" && parsed.token) {
            session = { accountId: parsed.accountId, token: parsed.token };
          }
        } catch { /* malformed credentials never restore an authenticated state */ }
        if (raw && !session) await credentials.removeItem(SESSION_KEY);
        if (session && await cache.getItem(REVOKED_KEY) === "1") session = null;
        if (version !== epoch) return { token: null, accountId: null, state: emptyState() };
        current = session;
        if (!session) {
          await cache.removeItem(SNAPSHOT_KEY);
          let draft = "";
          try { const value: unknown = JSON.parse(await cache.getItem(GUEST_KEY) ?? '""'); if (typeof value === "string") draft = value; } catch { /* invalid guest draft */ }
          if (version !== epoch) return { token: null, accountId: null, state: emptyState() };
          return { token: null, accountId: null, state: { ...emptyState(), draft } };
        }
        const state = parseState(await cache.getItem(SNAPSHOT_KEY), session.accountId) ?? { ...emptyState(), signedIn: true };
        if (version !== epoch) return { token: null, accountId: null, state: emptyState() };
        return { token: session.token, accountId: session.accountId, state: restoreAfterReopen(state) };
      });
    },
    clear(): Promise<void> {
      ++epoch; current = null;
      return enqueue(async () => {
        // A durable denial marker prevents a failed keychain deletion from restoring this account on next launch.
        const marker = await Promise.allSettled([cache.setItem(REVOKED_KEY, "1")]);
        const tasks = [credentials.removeItem(SESSION_KEY), cache.removeItem(GUEST_KEY), cache.removeItem(SNAPSHOT_KEY), removeLegacy()];
        const results = await Promise.allSettled(tasks);
        if ([...marker, ...results].some((r) => r.status === "rejected")) throw new Error("Could not finish clearing this device's session. Retry before signing in.");
      });
    },
  };
}
export type SessionStorage = ReturnType<typeof createSessionStorage>;
export const activateLocalSession = (store: SessionStorage, session: LocalSession) => store.activate(session);
export const persistSession = (store: SessionStorage, session: PersistedSession) => store.persist(session);
export const hydrateOnLaunch = (store: SessionStorage) => store.hydrate();
export const clearAccountLocal = (store: SessionStorage) => store.clear();
export const logoutLocal = (store: SessionStorage) => store.clear();
export const persistDraft = (store: SessionStorage, draft: string) => store.persist({ token: null, state: { ...emptyState(), draft } });
export const loadDraft = async (store: SessionStorage) => (await store.hydrate()).state.draft;

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return { getItem: async (k) => data[k] ?? null, setItem: async (k, v) => { data[k] = v; }, removeItem: async (k) => { delete data[k]; } };
}
