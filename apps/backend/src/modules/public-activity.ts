import {
  PUBLIC_ACTIVITY_LABELS,
  PUBLIC_ACTIVITY_SCHEMA_VERSION,
  SanitizedRunEventSchema,
  type PublicActivity,
  type PublicActivityKind,
  type SanitizedRunEvent,
} from "@deep/contracts";

export {
  PUBLIC_ACTIVITY_KINDS,
  PUBLIC_ACTIVITY_LABELS,
  PUBLIC_ACTIVITY_SCHEMA_VERSION,
  type PublicActivity,
  type PublicActivityKind,
  type SanitizedRunEvent,
} from "@deep/contracts";

export type PublicActivityEvent = PublicActivity;

const PRIVATE = /attachment:\/\/|BEGIN [A-Z ]+PRIVATE|sk-|api[_-]?key|password|prompt:|system message/i;
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

const TYPE_TO_KIND: Record<string, PublicActivityKind> = {
  criteria_prepared: "plan_ready",
  intent_compiled: "intent_ready",
  accepted: "intent_ready",
  clarification_needed: "clarification",
  clarification_answered: "clarification",
  clarify: "clarification",
  searching: "searching",
  searched: "searching",
  sources_found: "sources_found",
  source_reading: "source_reading",
  source_read: "source_reading",
  opened_source: "source_reading",
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

function publicHost(text: string): string | null {
  const m = text.match(/\bhttps?:\/\/([^/\s]+)/i);
  if (!m) return null;
  const host = m[1]!.replace(/^www\./, "");
  if (/localhost|127\.0\.0\.1/i.test(host) || host.includes("@") || host.includes(":")) return null;
  return host;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function createdAtString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toPublicActivity(event: {
  type: string;
  publicSummary: string;
  phase: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}): PublicActivity | null {
  if (PRIVATE_TYPES.has(event.type.toLowerCase())) return null;
  if (PRIVATE.test(event.publicSummary) || PRIVATE.test(JSON.stringify(event.payload ?? {}))) return null;
  const kind = TYPE_TO_KIND[event.type] ?? (/search/i.test(event.type) ? "searching" : null);
  if (!kind) return null;
  const countRaw = event.payload?.count;
  const count =
    typeof countRaw === "number" && Number.isFinite(countRaw) && countRaw >= 0 ? Math.floor(countRaw) : null;
  const titleRaw = event.payload?.title;
  const title =
    typeof titleRaw === "string" && titleRaw.trim() && !PRIVATE.test(titleRaw) && !/https?:\/\//i.test(titleRaw)
      ? titleRaw.trim()
      : null;
  return {
    kind,
    label: PUBLIC_ACTIVITY_LABELS[kind],
    phase: event.phase,
    count,
    sourceDomain: publicHost(event.publicSummary),
    sourceTitle: title,
    createdAt: event.createdAt,
  };
}

export function toSanitizedRunEvent(row: {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  public_summary: string;
  phase: string;
  created_at: Date | string;
  payload?: unknown;
}): SanitizedRunEvent {
  const createdAt = createdAtString(row.created_at);
  const payload = payloadRecord(row.payload);
  const activity = toPublicActivity({
    type: row.type,
    publicSummary: row.public_summary,
    phase: row.phase,
    createdAt,
    payload,
  });
  const candidate = {
    id: row.id,
    runId: row.runId,
    sequence: Number(row.sequence),
    createdAt,
    schemaVersion: PUBLIC_ACTIVITY_SCHEMA_VERSION,
    phase: row.phase,
    activity,
  };
  const parsed = SanitizedRunEventSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return {
    id: row.id,
    runId: row.runId,
    sequence: Number(row.sequence),
    createdAt,
    schemaVersion: PUBLIC_ACTIVITY_SCHEMA_VERSION,
    phase: row.phase || "researching",
    activity: null,
  };
}
