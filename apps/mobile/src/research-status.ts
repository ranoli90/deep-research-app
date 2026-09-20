/** One-line status copy for offline / failed / cancelled / empty progress. No cards. */

export const RESEARCH_STATUS_LINE = {
  offline: "You're offline.",
  failed: "Research failed.",
  cancelled: "Research cancelled.",
  waiting: "Waiting for the server.",
} as const;

export type ResearchStatusKind = keyof typeof RESEARCH_STATUS_LINE;

export type ResearchStatusLine = {
  kind: ResearchStatusKind;
  line: string;
  /** Offer an inline Retry control; composer stays available either way. */
  retry: boolean;
};

type StatusInput = {
  offline?: boolean;
  events?: unknown[];
  run?: {
    lifecycle: string;
    outcome?: string | null;
    contentInvalidated?: boolean;
  } | null;
  report?: unknown | null;
  pendingContentInvalidation?: string | null;
};

/**
 * Prefer a single status line over banners/cards for these states.
 * Active trails with real events stay in ResearchActivity.
 */
export function researchStatusLine(state: StatusInput): ResearchStatusLine | null {
  if (state.offline) {
    return { kind: "offline", line: RESEARCH_STATUS_LINE.offline, retry: true };
  }
  const run = state.run;
  if (!run || run.contentInvalidated === true || state.pendingContentInvalidation) return null;

  if (run.lifecycle === "terminal") {
    if (run.outcome === "failed") {
      return { kind: "failed", line: RESEARCH_STATUS_LINE.failed, retry: true };
    }
    if (run.outcome === "cancelled") {
      return { kind: "cancelled", line: RESEARCH_STATUS_LINE.cancelled, retry: false };
    }
    return null;
  }

  if (run.lifecycle === "cancelling") return null;
  if (!["queued", "running", "awaiting_input"].includes(run.lifecycle)) return null;
  const eventCount = Array.isArray(state.events) ? state.events.length : 0;
  if (eventCount > 0) return null;
  return { kind: "waiting", line: RESEARCH_STATUS_LINE.waiting, retry: true };
}
