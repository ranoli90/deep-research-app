import type { ControllerState, SearchTrace } from "./types.js";

export function saturationReached(searches: SearchTrace[]): boolean {
  if (searches.length < 2) return false;
  const last = searches.slice(-2);
  return last.every((s) => s.newFamilies === 0 && !s.coverageProgress);
}

/** Confirmed geography must appear in the public query so discovery cannot silently reuse another country's fixture. */
export function queryWithGeography(state: ControllerState, query: string): string {
  const geo = state.constraints.find((c) => c.field === "geography");
  const value = geo ? String(geo.value).trim() : "";
  if (!value) return query;
  if (query.toLowerCase().includes(value.toLowerCase())) return query;
  return `${query} ${value}`;
}

export function independentClusterCount(sources: { originCluster?: string; id: string }[]): number {
  const clusters = new Set<string>();
  for (const s of sources) {
    clusters.add(s.originCluster ?? `independent:${s.id}`);
  }
  return clusters.size;
}

export function searchDelta(
  previousFamilies: Set<string>,
  newFamilyIds: string[],
): { newFamilies: number; families: string[] } {
  let n = 0;
  for (const f of newFamilyIds) {
    if (!previousFamilies.has(f)) n += 1;
  }
  return { newFamilies: n, families: newFamilyIds };
}
