/** Semantic activity labels from persisted run events. Never invent work. */

export type ResearchEvent = {
  sequence: number;
  type: string;
  publicSummary: string;
  phase?: string;
  createdAt?: string;
};

const PRIVATE_TYPES = new Set([
  "thinking",
  "thought",
  "chain_of_thought",
  "cot",
  "raw_prompt",
  "prompt",
  "model_reasoning",
  "hidden",
]);

const TYPE_LABELS: Record<string, string> = {
  accepted: "Starting research",
  intent_compiled: "Understood the question",
  criteria_prepared: "Research questions are ready",
  clarification_needed: "Need one detail before continuing",
  clarify: "Need one detail before continuing",
  clarification_answered: "Saved your clarification",
  attachment_processing: "Reading your document",
  attachment_processed: "Finished reading your document",
  searching: "Searching public sources",
  searched: "Searching",
  sources_found: "Found sources",
  opened_source: "Reading a source",
  source_reading: "Reading a source",
  source_read: "Reading a source",
  source_unreadable: "Could not read a source",
  evidence_selected: "Selected evidence",
  evidence_checked: "Checked the evidence",
  counterevidence_checked: "Checking for disagreements",
  contradiction_found: "Found a disagreement",
  freshness_checking: "Checking how current the evidence is",
  discovery_exhausted: "Changed the search plan",
  source_pivot: "Research plan updated",
  calculations_executed: "Checked the numbers",
  disconfirm_search: "Checking a conflicting claim",
  writing: "Writing the answer",
  report_ready: "Answer ready",
  correction_accepted: "Updating from your correction",
  follow_up_accepted: "Rechecking the claim",
  cancel_requested: "Stopping new work",
  cancelled: "Research cancelled",
  stop_policy: "Reached a research limit",
  step_limit: "Reached a research limit",
  action_rejected: "Skipped a blocked step",
  deleted: "This research was removed",
};

function looksLikePrivateProse(text: string): boolean {
  return /^\s*[{[]/.test(text) || /\b(system prompt|chain of thought|hidden reasoning)\b/i.test(text);
}

export function labelResearchEvent(event: ResearchEvent): { label: string; detail: string | null } | null {
  if (PRIVATE_TYPES.has(event.type.toLowerCase())) return null;
  const summary = event.publicSummary.trim();
  if (looksLikePrivateProse(summary)) return null;
  const mapped = TYPE_LABELS[event.type];
  if (!mapped) return null;
  const hideDetail = event.type === "source_pivot" || event.type === "action_rejected" || event.type === "stop_policy";
  const detail = !hideDetail && summary && summary.toLowerCase() !== mapped.toLowerCase() ? summary : null;
  return { label: mapped, detail };
}

export function visibleResearchEvents(events: ResearchEvent[]): Array<ResearchEvent & { label: string; detail: string | null }> {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      const labeled = labelResearchEvent(event);
      return labeled ? { ...event, ...labeled } : null;
    })
    .filter((event): event is ResearchEvent & { label: string; detail: string | null } => event !== null);
}

function sourceCount(events: ResearchEvent[]): number {
  const opened = events.filter((e) => e.type === "opened_source");
  const read = events.filter((e) => e.type === "source_read");
  const counted = opened.length > 0 ? opened : read;
  return new Set(counted.map((e) => e.sequence)).size;
}

function eventTimes(events: ResearchEvent[]): number[] {
  return events
    .map((e) => (e.createdAt ? Date.parse(e.createdAt) : Number.NaN))
    .filter((n) => Number.isFinite(n));
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

function elapsedLabel(events: ResearchEvent[]): string | null {
  const stamps = eventTimes(events);
  if (stamps.length < 2) return null;
  return formatElapsed(Math.max(0, Math.max(...stamps) - Math.min(...stamps)));
}

/** Elapsed from the first recorded event to now. Never invents work. */
export function runningElapsedLabel(events: ResearchEvent[], nowMs: number): string | null {
  const stamps = eventTimes(events);
  if (stamps.length === 0 || !Number.isFinite(nowMs)) return null;
  const start = Math.min(...stamps);
  if (nowMs < start) return null;
  return formatElapsed(nowMs - start);
}

export function collapseResearchActivity(args: {
  events: ResearchEvent[];
  lifecycle?: string;
  outcome?: string | null;
}): { summary: string; expandable: boolean } {
  const visible = visibleResearchEvents(args.events);
  if (visible.length === 0) {
    if (args.lifecycle && args.lifecycle !== "terminal") {
      return { summary: "Waiting for the server.", expandable: false };
    }
    return { summary: "No research activity was recorded.", expandable: false };
  }
  const sources = sourceCount(args.events);
  const elapsed = elapsedLabel(args.events);
  const parts: string[] = [];
  if (args.outcome === "cancelled" || args.events.some((e) => e.type === "cancelled")) {
    parts.push("Research cancelled");
  } else if (args.lifecycle === "awaiting_input") {
    parts.push("Waiting for a detail");
  } else if (args.outcome === "failed") {
    parts.push("Research failed");
  } else if (sources > 0) {
    parts.push(`Researched ${sources} source${sources === 1 ? "" : "s"}`);
  } else {
    parts.push("Research complete");
  }
  if (elapsed) parts.push(elapsed);
  return { summary: parts.join(" · "), expandable: visible.length > 0 };
}

export function currentActivityLine(events: ResearchEvent[]): string {
  const visible = visibleResearchEvents(events);
  return visible.at(-1)?.label ?? "Waiting for the server.";
}
