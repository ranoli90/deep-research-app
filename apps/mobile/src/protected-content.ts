import type { KeyValueStore } from "./persist";

const CONTENT_KEYS = new Set(["deep.ui.v2", "deep.draft.guest", "deep.admission.v1", "deep.correction-documents.v1", "deep.content-invalidation.v1", "norrow.guest.snapshot.v1", "norrow.guest.first-request.v1", "norrow.guest.pending-action.v2", "norrow.guest.abandoned-actions.v1"]);
const MAX_LENGTH = 2_000_000, CHUNK_BYTES = 1600, MAX_CHUNKS = 8192;
type Manifest = { version: 1; active: 0 | 1 | null; counts: [number, number] };
function manifest(raw: string | null): Manifest {
  if (raw === null) return { version: 1, active: null, counts: [0, 0] };
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== "object") throw new Error("Invalid protected content manifest.");
  const m = v as Manifest;
  if (m.version !== 1 || ![null, 0, 1].includes(m.active) || !Array.isArray(m.counts) || m.counts.length !== 2 ||
      m.counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > MAX_CHUNKS) ||
      (m.active !== null && m.counts[m.active] < 1)) throw new Error("Invalid protected content manifest.");
  return m;
}
function chunks(value: string): string[] {
  if (value.length > MAX_LENGTH) throw new Error("Protected content is too large.");
  const out: string[] = []; let part = "", bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    const size = cp > 0xffff ? 4 : cp > 0x7ff ? 3 : cp > 0x7f ? 2 : 1;
    if (bytes + size > CHUNK_BYTES) { out.push(part); part = ""; bytes = 0; }
    part += char; bytes += size;
  }
  out.push(part);
  if (out.length > MAX_CHUNKS) throw new Error("Protected content has too many chunks.");
  return out;
}

/** Native encrypted/keychain store holds content; ordinary storage holds denial/install flags only.
 * SessionStorage serializes operations. Two fixed slots preserve the old snapshot until commit;
 * allocation metadata is durable before chunk writes so interrupted writes remain deletable.
 */
export function createProtectedContentStore(ordinary: KeyValueStore, secure: KeyValueStore): KeyValueStore {
  const meta = (key: string) => `${key}.content.v1`;
  const denied = (key: string) => `${key}.content.denied`;
  const chunkKey = (key: string, slot: number, i: number) => `${meta(key)}.${slot}.${i}`;
  async function clearSlot(key: string, slot: number, count: number) {
    for (let i = 0; i < count; i += 8) await Promise.all(Array.from({ length: Math.min(8, count - i) }, (_, j) => secure.removeItem(chunkKey(key, slot, i + j))));
  }
  async function write(key: string, value: string) {
    const parts = chunks(value), m = manifest(await secure.getItem(meta(key))), slot = m.active === 0 ? 1 : 0;
    await clearSlot(key, slot, m.counts[slot]);
    m.counts[slot] = parts.length;
    await secure.setItem(meta(key), JSON.stringify(m));
    for (let i = 0; i < parts.length; i++) await secure.setItem(chunkKey(key, slot, i), parts[i]!);
    const old = m.active;
    m.active = slot;
    await secure.setItem(meta(key), JSON.stringify(m));
    if (old !== null) { await clearSlot(key, old, m.counts[old]); m.counts[old] = 0; await secure.setItem(meta(key), JSON.stringify(m)); }
    await ordinary.removeItem(key); // Migrate plaintext only after protected commit; no plaintext fallback.
    await ordinary.removeItem(denied(key));
  }
  async function remove(key: string) {
    await ordinary.setItem(denied(key), "1"); // Survives a failed native deletion or process death.
    await ordinary.removeItem(key);
    const m = manifest(await secure.getItem(meta(key)));
    m.active = null;
    await secure.setItem(meta(key), JSON.stringify(m));
    await clearSlot(key, 0, m.counts[0]); await clearSlot(key, 1, m.counts[1]);
    await secure.removeItem(meta(key));
  }
  return {
    async getItem(key) {
      if (!CONTENT_KEYS.has(key)) {
        const value = await ordinary.getItem(key);
        // iOS keychain content can survive uninstall; an absent install marker revokes it.
        if (key === "deep.install.v2" && value === null) for (const contentKey of CONTENT_KEYS) await remove(contentKey);
        return value;
      }
      if (await ordinary.getItem(denied(key)) === "1") return null;
      const m = manifest(await secure.getItem(meta(key)));
      if (m.active === null) {
        const legacy = await ordinary.getItem(key);
        if (legacy === null) return null;
        await write(key, legacy); return legacy;
      }
      let value = "";
      for (let i = 0; i < m.counts[m.active]; i++) {
        const part = await secure.getItem(chunkKey(key, m.active, i));
        if (part === null) throw new Error("Protected content is incomplete.");
        value += part;
        if (value.length > MAX_LENGTH) throw new Error("Protected content is too large.");
      }
      await ordinary.removeItem(key);
      return value;
    },
    setItem: (key, value) => CONTENT_KEYS.has(key) ? write(key, value) : ordinary.setItem(key, value),
    removeItem: key => CONTENT_KEYS.has(key) ? remove(key) : ordinary.removeItem(key),
  };
}
