import type { UiState } from "./state.js";

export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const DRAFT_KEY = "deep.draft";
const SNAP_KEY = "deep.ui";

export async function persistDraft(store: KeyValueStore, draft: string): Promise<void> {
  await store.setItem(DRAFT_KEY, draft);
}

export async function loadDraft(store: KeyValueStore): Promise<string> {
  return (await store.getItem(DRAFT_KEY)) ?? "";
}

export async function persistSnapshot(store: KeyValueStore, state: Pick<UiState, "draft" | "run" | "report" | "readingAnchor" | "routeMode" | "consentGranted" | "signedIn">): Promise<void> {
  await store.setItem(SNAP_KEY, JSON.stringify(state));
}

export async function loadSnapshot(store: KeyValueStore): Promise<ReturnType<typeof JSON.parse> | null> {
  const raw = await store.getItem(SNAP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearAccountLocal(store: KeyValueStore): Promise<void> {
  await store.removeItem(SNAP_KEY);
  await store.removeItem(DRAFT_KEY);
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
