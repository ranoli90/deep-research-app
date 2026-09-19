import {
  PublicActivitySchema,
  type PublicActivity,
  type PublicActivityKind,
} from "@deep/contracts";

/** Client event after /events sanitization. Legacy type/publicSummary are not authority. */
export type ResearchEvent = {
  sequence: number;
  createdAt?: string;
  phase?: string;
  activity: PublicActivity | null;
};

export type VisibleResearchEvent = ResearchEvent & {
  kind: PublicActivityKind;
  label: string;
  detail: string | null;
  sourceTitle: string | null;
  sourceDomain: string | null;
  count: number | null;
};

function parseActivity(value: unknown): PublicActivity | null {
  const parsed = PublicActivitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Keep sequence/activity only. Ignore leftover type, publicSummary, and payload. */
export function adoptPublicEvents(raw: unknown): ResearchEvent[] {
  if (!Array.isArray(raw)) return [];
  const bySeq = new Map<number, ResearchEvent>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const sequence = Number(rec.sequence);
    if (!Number.isInteger(sequence) || sequence < 0) continue;
    bySeq.set(sequence, {
      sequence,
      createdAt: typeof rec.createdAt === "string" ? rec.createdAt : undefined,
      phase: typeof rec.phase === "string" ? rec.phase : undefined,
      activity: parseActivity(rec.activity),
    });
  }
  return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
}

function activityDetail(activity: PublicActivity): string | null {
  const parts: string[] = [];
  if (activity.sourceTitle) parts.push(activity.sourceTitle);
  if (activity.sourceDomain) parts.push(activity.sourceDomain);
  if (activity.count != null && parts.length === 0) parts.push(String(activity.count));
  return parts.length ? parts.join(" · ") : null;
}

export function labelResearchEvent(event: ResearchEvent): { label: string; detail: string | null } | null {
  if (!event.activity) return null;
  return { label: event.activity.label, detail: activityDetail(event.activity) };
}

export function visibleResearchEvents(events: ResearchEvent[]): VisibleResearchEvent[] {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((event) => {
      if (!event.activity) return [];
      return [{
        ...event,
        activity: event.activity,
        kind: event.activity.kind,
        label: event.activity.label,
        detail: activityDetail(event.activity),
        sourceTitle: event.activity.sourceTitle,
        sourceDomain: event.activity.sourceDomain,
        count: event.activity.count,
      }];
    });
}

function sourceCount(events: ResearchEvent[]): number {
  const reads = events.filter((e) => e.activity?.kind === "source_reading");
  return new Set(reads.map((e) => e.sequence)).size;
}

function eventTimes(events: ResearchEvent[]): number[] {
  return events
    .map((e) => {
      const stamp = e.createdAt ?? e.activity?.createdAt;
      return stamp ? Date.parse(stamp) : Number.NaN;
    })
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
  if (args.outcome === "cancelled") {
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
