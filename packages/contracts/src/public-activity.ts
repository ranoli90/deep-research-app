import { z } from "zod";

/** Consumer GET /v1/runs/:id/events identity. Persistence still stores type/public_summary internally. */
export const PUBLIC_ACTIVITY_SCHEMA_VERSION = "public-activity.v1";

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

export const PublicActivitySchema = z
  .object({
    kind: z.enum(PUBLIC_ACTIVITY_KINDS),
    label: z.string().min(1).max(200),
    phase: z.string().min(1).max(64),
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
    phase: z.string().min(1).max(64),
    activity: PublicActivitySchema.nullable(),
  })
  .strict();
export type SanitizedRunEvent = z.infer<typeof SanitizedRunEventSchema>;
