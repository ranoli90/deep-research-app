/** Immutable report IDs identify versions; the account envelope owns persisted anchors. */
export type ReportReadingAnchor = { reportId: string; blockId: string; offset: number };
export type ReadingScope = { ownerKey: string; reportId: string };
export type ReadingRestore =
  | { kind: "none" | "waiting" }
  | { kind: "ready"; y: number; anchor: ReportReadingAnchor; note?: string };

/** One restoration per mounted reader. Native layout callbacks can arrive in any order. */
export function createReadingRestoration() {
  let generation = 0;
  let scope: ReadingScope | null = null;
  let ids: string[] = [];
  let canonicalIds: string[] = [];
  let pending: ReportReadingAnchor | null = null;
  let cardY: number | null = null;
  let viewportHeight: number | null = null, contentHeight: number | null = null;
  const positions = new Map<string, number>();
  function active(view: number) { return view === generation && scope !== null; }
  function coordinate(value: number) { return Number.isFinite(value) && value >= 0; }
  return {
    begin(owner: ReadingScope, saved: ReportReadingAnchor | null, blockIds: readonly string[], allBlockIds: readonly string[] = blockIds): number {
      generation++;
      scope = owner.ownerKey && owner.reportId ? { ...owner } : null;
      ids = [...blockIds]; canonicalIds = [...allBlockIds]; cardY = null; viewportHeight = null; contentHeight = null; positions.clear();
      pending = scope && saved?.reportId === owner.reportId && typeof saved.blockId === "string" && saved.blockId &&
        Number.isFinite(saved.offset) && new Set(ids).size === ids.length ? { ...saved } : null;
      return generation;
    },
    clear() { generation++; scope = null; ids = []; canonicalIds = []; pending = null; cardY = null; viewportHeight = null; contentHeight = null; positions.clear(); },
    measureCard(view: number, y: number) {
      if (active(view) && coordinate(y)) cardY = y;
    },
    measureBlock(view: number, id: string, y: number) {
      if (active(view) && ids.includes(id) && coordinate(y)) positions.set(id, y);
    },
    measureViewport(view: number, height: number) {
      if (active(view) && coordinate(height)) viewportHeight = height;
    },
    measureContent(view: number, height: number) {
      if (active(view) && coordinate(height)) contentHeight = height;
    },
    /** Call for actual user drag/outline navigation, not programmatic onScroll events. */
    userScrolled(view: number) { if (active(view)) pending = null; },
    take(view: number): ReadingRestore {
      if (!active(view) || !pending || !ids.length) return { kind: "none" };
      const moved = !ids.includes(pending.blockId);
      const hidden = moved && canonicalIds.includes(pending.blockId);
      const anchor = moved ? { ...pending, blockId: ids[0]!, offset: 0 } : pending;
      const blockY = positions.get(anchor.blockId);
      if (cardY === null || blockY === undefined || !viewportHeight || !contentHeight || contentHeight <= cardY + blockY)
        return { kind: "waiting" };
      const y = cardY + blockY + anchor.offset;
      if (!Number.isFinite(y)) { pending = null; return { kind: "none" }; }
      pending = null;
      return { kind: "ready", y: Math.max(0, Math.min(y, contentHeight - viewportHeight)), anchor: { ...anchor },
        ...(moved ? { note: hidden ? "That section is hidden in this view. Showing the first visible section." : "That section changed in the saved report. Showing its first available section." } : {}) };
    },
    /** Outline jump: measured card+block y, or null until layout exists. Does not consume restore. */
    jumpY(view: number, blockId: string): number | null {
      if (!active(view) || cardY === null) return null;
      const blockY = positions.get(blockId);
      if (blockY === undefined) return null;
      return Math.max(0, cardY + blockY);
    },
    /** Save only measured blocks from this reader; stale/foreign callbacks cannot create anchors. */
    capture(view: number, scrollY: number, preferredBlockId?: string): ReportReadingAnchor | null {
      if (!active(view) || cardY === null || !Number.isFinite(scrollY)) return null;
      const ordered = [...positions].sort((a, b) => a[1] - b[1]);
      const id = preferredBlockId ?? ordered.filter(([, y]) => cardY! + y <= scrollY).at(-1)?.[0] ?? ordered[0]?.[0];
      if (!id || !positions.has(id)) return null;
      const offset = scrollY - cardY - positions.get(id)!;
      if (!Number.isFinite(offset)) return null;
      return { reportId: scope!.reportId, blockId: id, offset };
    },
  };
}
