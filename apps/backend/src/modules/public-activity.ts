const PRIVATE = /attachment:\/\/|BEGIN [A-Z ]+PRIVATE|sk-|api[_-]?key|password|prompt:|system message/i;

export const PUBLIC_ACTIVITY_KINDS = [
  "intent_ready",
  "clarification",
  "plan_ready",
  "searching",
  "sources_found",
  "source_reading",
  "source_unreadable",
  "evidence_selected",
  "evidence_checked",
  "contradiction_checking",
  "contradiction_found",
  "freshness_checking",
  "plan_pivot",
  "calculation",
  "writing",
  "report_ready",
] as const;

export type PublicActivityKind = (typeof PUBLIC_ACTIVITY_KINDS)[number];

const TYPE_TO_KIND: Record<string, PublicActivityKind> = {
  criteria_prepared: "plan_ready",
  intent_compiled: "intent_ready",
  clarification_needed: "clarification",
  clarification_answered: "clarification",
  searching: "searching",
  sources_found: "sources_found",
  source_reading: "source_reading",
  source_unreadable: "source_unreadable",
  evidence_selected: "evidence_selected",
  evidence_checked: "evidence_checked",
  counterevidence_checked: "contradiction_checking",
  contradiction_found: "contradiction_found",
  freshness_checking: "freshness_checking",
  discovery_exhausted: "plan_pivot",
  calculations_executed: "calculation",
  writing: "writing",
  report_ready: "report_ready",
  research_unresolved: "plan_pivot",
};

const LABELS: Record<PublicActivityKind, string> = {
  intent_ready: "Understood the question",
  clarification: "Needed a detail",
  plan_ready: "Research questions are ready",
  searching: "Searching public sources",
  sources_found: "Found sources",
  source_reading: "Reading a source",
  source_unreadable: "Could not read a source",
  evidence_selected: "Selected evidence",
  evidence_checked: "Checked the evidence",
  contradiction_checking: "Checking for disagreements",
  contradiction_found: "Found a disagreement",
  freshness_checking: "Checking how current the evidence is",
  plan_pivot: "Changed the search plan",
  calculation: "Checked the numbers",
  writing: "Writing the answer",
  report_ready: "Answer ready",
};

export type PublicActivityEvent = {
  kind: PublicActivityKind;
  label: string;
  phase: string;
  count: number | null;
  sourceDomain: string | null;
  sourceTitle: string | null;
  createdAt: string;
};

function publicHost(text: string): string | null {
  const m = text.match(/\bhttps?:\/\/([^/\s]+)/i);
  if (!m) return null;
  const host = m[1]!.replace(/^www\./, "");
  if (/localhost|127\.0\.0\.1/i.test(host)) return null;
  return host;
}

export function toPublicActivity(event: {
  type: string;
  publicSummary: string;
  phase: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}): PublicActivityEvent | null {
  if (PRIVATE.test(event.publicSummary) || PRIVATE.test(JSON.stringify(event.payload ?? {}))) return null;
  const kind = TYPE_TO_KIND[event.type];
  if (!kind) {
    if (/search/i.test(event.type)) return { kind: "searching", label: LABELS.searching, phase: event.phase, count: null, sourceDomain: publicHost(event.publicSummary), sourceTitle: null, createdAt: event.createdAt };
    return null;
  }
  const count = typeof event.payload?.count === "number" ? event.payload.count : null;
  const title = typeof event.payload?.title === "string" && !PRIVATE.test(event.payload.title) ? event.payload.title : null;
  return {
    kind,
    label: LABELS[kind],
    phase: event.phase,
    count,
    sourceDomain: publicHost(event.publicSummary),
    sourceTitle: title,
    createdAt: event.createdAt,
  };
}
