import { detectGaps } from "./gaps.js";
import { detectContradictions } from "./contradictions.js";
import { deriveResearchQuestions } from "./questions.js";
import type { ControllerState, StoredPassage } from "./types.js";

export type HitInput = {
  locator: string;
  title: string;
  originCluster?: string;
  sourceType?: string;
  population?: string;
  snippet?: string;
  accessLevel?: StoredPassage extends never ? never : "discovered" | "snippet";
};

export type FetchedInput = {
  locator: string;
  text: string;
  accessLevel: "full-text" | "snippet" | "blocked" | "partial-text";
  sourceType?: string;
  title?: string;
};

/** Apply search hits onto controller state (pure, no I/O). */
export function applySearchHits(state: ControllerState, query: string, hits: HitInput[]): void {
  const seen = new Set(state.searches.flatMap((s) => s.sourceFamilyIds));
  const families = hits.map((h) => h.originCluster ?? h.locator);
  let newFamilies = 0;
  for (const f of families) {
    if (!seen.has(f)) newFamilies += 1;
  }
  state.searches.push({
    query,
    sourceFamilyIds: families,
    newFamilies,
    coverageProgress: newFamilies > 0,
  });
  for (const hit of hits) {
    if (state.sources.some((s) => s.locator === hit.locator)) continue;
    state.sources.push({
      id: hit.locator,
      title: hit.title,
      locator: hit.locator,
      accessLevel: hit.snippet ? "snippet" : "discovered",
      originCluster: hit.originCluster,
      sourceType: hit.sourceType,
      population: hit.population,
      snippet: hit.snippet,
    });
  }
  refreshDerived(state);
}

export function applyFetchedDocument(state: ControllerState, doc: FetchedInput): StoredPassage {
  const src = state.sources.find((s) => s.locator === doc.locator || s.id === doc.locator);
  if (src) {
    src.accessLevel = doc.accessLevel;
    if (doc.sourceType) src.sourceType = doc.sourceType;
  }
  const passage: StoredPassage = {
    id: `p-${state.passages.length + 1}`,
    sourceId: src?.id ?? doc.locator,
    sourceVersionId: `v-${state.passages.length + 1}`,
    exactText: doc.text,
    locator: "document",
  };
  state.passages.push(passage);
  refreshDerived(state);
  return passage;
}

export function recordCompletedAction(state: ControllerState, type: string): void {
  state.completedActionTypes = [...(state.completedActionTypes ?? []), type];
}

export function refreshDerived(state: ControllerState): void {
  state.questions = deriveResearchQuestions(state);
  state.contradictions = detectContradictions(state);
  state.gaps = detectGaps(state);
}
