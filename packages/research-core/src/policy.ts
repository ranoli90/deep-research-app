import type { ControllerState, SearchTrace } from "./types.js";

export function saturationReached(searches: SearchTrace[]): boolean {
  if (searches.length < 2) return false;
  const last = searches.slice(-2);
  return last.every((s) => s.newFamilies === 0 && !s.coverageProgress);
}

/** Confirmed values that may enter a public query without rewriting originalQuestion. */
export function confirmedPublicQueryTerms(constraints: { field: string; value: string; units?: string; origin?: string }[]): string[] {
  const terms: string[] = [];
  for (const c of constraints) {
    if (c.origin !== "confirmed") continue;
    if (c.field === "geography" || c.field === "jurisdiction") {
      const value = String(c.value ?? "").trim();
      if (value && !terms.some((t) => t.toLowerCase() === value.toLowerCase())) terms.push(value);
      continue;
    }
    if (c.field === "budget") {
      const value = String(c.value ?? "").trim();
      const units = String(c.units ?? "").trim();
      const term = [value, units].filter(Boolean).join(" ");
      if (term && !terms.some((t) => t.toLowerCase() === term.toLowerCase())) terms.push(term);
    }
  }
  return terms;
}

/** Append confirmed geography to a query. publicQueryBasis stays an exact original-question span. */
export function withConfirmedPublicQueryTerms(query: string, constraints: { field: string; value: string; origin?: string }[]): string {
  let out = query;
  for (const value of confirmedPublicQueryTerms(constraints)) {
    if (out.toLowerCase().includes(value.toLowerCase())) continue;
    out = `${out} ${value}`;
  }
  return out;
}

/** Confirmed geography must appear in the public query so discovery cannot silently reuse another country's fixture. */
export function queryWithGeography(state: ControllerState, query: string): string {
  return withConfirmedPublicQueryTerms(query, state.constraints);
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
