import type { ControllerState } from "./types.js";

/** Keep hard constraints and evidence IDs when a long run is compacted. */
export function compactForContext(state: ControllerState): {
  constraints: { field: string; value: string; units?: string; importance: string }[];
  passageIds: string[];
  provenance: { passageId: string; sourceId: string }[];
  droppedSearchCount: number;
} {
  return {
    constraints: state.constraints.map((c) => ({
      field: c.field,
      value: c.value,
      units: c.units,
      importance: c.importance,
    })),
    passageIds: state.passages.map((p) => p.id),
    provenance: state.passages.map((p) => ({ passageId: p.id, sourceId: p.sourceId })),
    droppedSearchCount: Math.max(0, state.searches.length - 2),
  };
}
