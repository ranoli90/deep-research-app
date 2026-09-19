import { z } from "zod";

/** Consumer GET /v1/runs/:id/events identity. Persistence still stores type/public_summary internally. */
export const PUBLIC_ACTIVITY_SCHEMA_VERSION = "public-activity.v1";

export const PUBLIC_ACTIVITY_PHASES = ["preparing", "researching", "verifying", "writing"] as const;
export type PublicActivityPhase = (typeof PUBLIC_ACTIVITY_PHASES)[number];
/** Envelope phase when the stored phase is missing, oversized, or unknown. Never echo raw phase. */
export const PUBLIC_ACTIVITY_FALLBACK_PHASE: PublicActivityPhase = "researching";

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

export const PUBLIC_ACTIVITY_LABELS: Record<PublicActivityKind, string> = {
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

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]},]+/gi;

function isRfc1918(a: number, b: number): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (host.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    if (isRfc1918(a, b) || a === 127 || a === 0 || a === 169) return false;
    return false;
  }
  return true;
}

/** Same public-host gate used by source locators and activity.sourceDomain. */
export function publicSourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (!isPublicHostname(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function publicSourceHost(value: string | undefined): string | null {
  const url = publicSourceUrl(value);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** First public hostname in free text, or null. Private/RFC1918/.internal hosts are omitted. */
export function publicSourceHostFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const host = publicSourceHost(match[0].replace(/[.,;:!?)]+$/u, ""));
    if (host) return host;
  }
  return null;
}

export function publicActivityPhase(value: string | null | undefined): PublicActivityPhase {
  if (value && (PUBLIC_ACTIVITY_PHASES as readonly string[]).includes(value)) return value as PublicActivityPhase;
  return PUBLIC_ACTIVITY_FALLBACK_PHASE;
}

export const PublicActivitySchema = z
  .object({
    kind: z.enum(PUBLIC_ACTIVITY_KINDS),
    label: z.string().min(1).max(200),
    phase: z.enum(PUBLIC_ACTIVITY_PHASES),
    count: z.number().int().nonnegative().nullable(),
    sourceDomain: z.string().min(1).max(253).nullable(),
    sourceTitle: z.string().min(1).max(200).nullable(),
    createdAt: z.string().min(1),
  })
  .strict();
export type PublicActivity = z.infer<typeof PublicActivitySchema>;

export const SanitizedRunEventSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
    schemaVersion: z.literal(PUBLIC_ACTIVITY_SCHEMA_VERSION),
    phase: z.enum(PUBLIC_ACTIVITY_PHASES),
    activity: PublicActivitySchema.nullable(),
  })
  .strict();
export type SanitizedRunEvent = z.infer<typeof SanitizedRunEventSchema>;
