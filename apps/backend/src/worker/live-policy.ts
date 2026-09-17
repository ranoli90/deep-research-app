import { selectBaselineAction, type ControllerState } from "@deep/research-core";

export type LiveNext = {
  type: "search" | "fetch" | "synthesize";
  rationale: string;
  query?: string;
  locator?: string;
  sourceId?: string;
};

/** Bounded live chooser. Not an adaptive engine; proposals still require admitProposedAction. */
export function nextLiveAction(state: ControllerState): LiveNext {
  const d = selectBaselineAction(state);
  const type = d.type === "fetch" || d.type === "search" || d.type === "synthesize" ? d.type : "synthesize";
  return {
    type,
    rationale: d.rationale,
    query: d.arguments.query ? String(d.arguments.query) : undefined,
    locator: d.arguments.locator ? String(d.arguments.locator) : undefined,
    sourceId: d.arguments.sourceId ? String(d.arguments.sourceId) : undefined,
  };
}
