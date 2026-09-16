import type { ControllerState } from "@deep/research-core";

export type LiveNext = {
  type: "search" | "fetch" | "synthesize";
  rationale: string;
  query?: string;
  locator?: string;
  sourceId?: string;
};

const MAX_LIVE_FETCHES = 3;

/** App-owned live controller: one discovery search, then inspect URLs, then write. */
export function nextLiveAction(state: ControllerState): LiveNext {
  const httpSources = state.sources.filter((s) => (s.locator ?? "").startsWith("http"));
  const unfetched = httpSources.filter((s) => s.accessLevel === "discovered" || s.accessLevel === "snippet");
  const fetchedCount = httpSources.length - unfetched.length;

  if (httpSources.length === 0 && state.searches.length === 0) {
    return {
      type: "search",
      rationale: "Live discovery of public sources for the task",
      query: state.brief.originalQuestion,
    };
  }
  if (unfetched[0] && fetchedCount < MAX_LIVE_FETCHES) {
    return {
      type: "fetch",
      rationale: "Inspect an already-known live source before another paid search",
      locator: unfetched[0].locator,
      sourceId: unfetched[0].id,
    };
  }
  return {
    type: "synthesize",
    rationale: "Write a bounded cited report from accessed live evidence",
  };
}
