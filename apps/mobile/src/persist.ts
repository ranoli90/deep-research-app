import { emptyState, restoreAfterReopen, type UiState } from "./state.js";

export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const DRAFT_KEY = "deep.draft";
const SNAP_KEY = "deep.ui";
const TOKEN_KEY = "deep.token";

export type PersistedSession = {
  token: string | null;
  state: Pick<
    UiState,
    "draft" | "run" | "report" | "readingAnchor" | "routeMode" | "consentGranted" | "signedIn" | "previousReport" | "status"
  >;
};

export async function persistDraft(store: KeyValueStore, draft: string): Promise<void> {
  await store.setItem(DRAFT_KEY, draft);
}

export async function loadDraft(store: KeyValueStore): Promise<string> {
  return (await store.getItem(DRAFT_KEY)) ?? "";
}

export async function persistSnapshot(
  store: KeyValueStore,
  state: PersistedSession["state"],
): Promise<void> {
  await store.setItem(SNAP_KEY, JSON.stringify(state));
}

export async function loadSnapshot(store: KeyValueStore): Promise<PersistedSession["state"] | null> {
  const raw = await store.getItem(SNAP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession["state"];
  } catch {
    return null;
  }
}

/** App calls this after draft/run/report/auth changes so close/reopen can restore the session. */
export async function persistSession(store: KeyValueStore, session: PersistedSession): Promise<void> {
  if (session.token) await store.setItem(TOKEN_KEY, session.token);
  else await store.removeItem(TOKEN_KEY);
  await persistDraft(store, session.state.draft);
  await persistSnapshot(store, session.state);
}

/** App calls this on launch. Uses loadDraft + snapshot + token; empty store yields an empty session. */
export async function hydrateOnLaunch(store: KeyValueStore): Promise<{ token: string | null; state: UiState }> {
  const token = (await store.getItem(TOKEN_KEY)) || null;
  const snap = await loadSnapshot(store);
  const draft = await loadDraft(store);
  const merged: UiState = {
    ...emptyState(),
    ...(snap ?? {}),
    draft: draft || snap?.draft || "",
    signedIn: Boolean(token) || Boolean(snap?.signedIn),
    consentGranted: Boolean(snap?.consentGranted),
    run: snap?.run ?? null,
    report: snap?.report ?? null,
    previousReport: snap?.previousReport ?? null,
    readingAnchor: snap?.readingAnchor ?? null,
    routeMode: snap?.routeMode ?? "fixture",
    status: snap?.status ?? (snap?.run ? "progress" : "empty"),
  };
  return { token, state: restoreAfterReopen(merged) };
}

export async function clearAccountLocal(store: KeyValueStore): Promise<void> {
  await store.removeItem(SNAP_KEY);
  await store.removeItem(DRAFT_KEY);
  await store.removeItem(TOKEN_KEY);
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
    removeItem: async (k) => {
      delete data[k];
    },
  };
}
