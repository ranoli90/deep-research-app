import { z } from "zod";

export const PENDING_INPUT_CONTRACT_VERSION = "pending-input.v1";

export const PendingInputTypeSchema = z.enum(["clarification", "query_authorization"]);
export type PendingInputType = z.infer<typeof PendingInputTypeSchema>;

export const ClarificationFieldSchema = z.enum([
  "geography",
  "budget",
  "use_case",
  "population",
  "timeframe",
  "platform",
  "private_search",
  "subject",
  "currency",
  "safety",
]);
export type ClarificationField = z.infer<typeof ClarificationFieldSchema>;

export function pendingClarificationField(value: unknown): ClarificationField | undefined {
  const parsed = ClarificationFieldSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Pause identity is the declared field set. A single column is a one-element set. */
export function declaredClarificationFields(
  pending: ClarificationField | readonly ClarificationField[] | null | undefined,
): ClarificationField[] {
  const values = pending == null ? [] : Array.isArray(pending) ? pending : [pending];
  const fields: ClarificationField[] = [];
  for (const value of values) {
    const field = pendingClarificationField(value);
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

export const PendingInputSchema = z.object({
  id: z.string().uuid(),
  type: PendingInputTypeSchema,
  briefRevision: z.number().int().positive(),
  field: ClarificationFieldSchema.optional(),
}).strict();
export type PendingInput = z.infer<typeof PendingInputSchema>;

const boundedText = z.string().trim().min(1).max(4000);
const revision = z.number().int().positive();

export const ContinueRunRequestSchema = z.object({
  pendingInputId: z.string().uuid(),
  expectedBriefRevision: revision,
  geography: z.string().trim().min(1).max(300).optional(),
  answers: z.array(z.object({ field: ClarificationFieldSchema, value: boundedText }).strict()).min(1).max(24).optional(),
}).strict().refine((body) => Boolean(body.geography || (body.answers && body.answers.length)), {
  message: "A material clarification answer is required.",
});
export type ContinueRunRequest = z.infer<typeof ContinueRunRequestSchema>;

export const AssumptionsRequestSchema = z.object({
  action: z.enum(["confirm", "replace"]),
  values: z.array(boundedText).max(12).optional(),
  expectedBriefRevision: revision.optional(),
}).strict().superRefine((body, ctx) => {
  if (body.action === "replace") {
    if (!body.expectedBriefRevision) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expectedBriefRevision is required to replace assumptions." });
    if (!body.values?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Replacement assumptions cannot be empty." });
  }
});
export type AssumptionsRequest = z.infer<typeof AssumptionsRequestSchema>;

export const FollowUpMessageRequestSchema = z.object({
  message: boundedText,
  expectedBriefRevision: revision.optional(),
}).strict();
export type FollowUpMessageRequest = z.infer<typeof FollowUpMessageRequestSchema>;

export type ClarificationAnswerRow = { field: ClarificationField; value: string };

/**
 * The continue decoder. Declared pause fields are the only accepted answers.
 * A single pending field still 400s extras. An explicit multi-field identity
 * accepts only that set; missing or conflicting values fail closed.
 */
export function clarificationAnswersFromContinue(
  body: { geography?: string; answers?: { field?: string; value?: string }[] },
  pendingField: ClarificationField | readonly ClarificationField[] | null | undefined,
): { ok: true; answers: ClarificationAnswerRow[] } | { ok: false; reason: string } {
  const declared = declaredClarificationFields(pendingField);
  const rows: ClarificationAnswerRow[] = [];
  for (const row of body.answers ?? []) {
    const field = pendingClarificationField(row.field);
    const value = String(row.value ?? "").trim();
    if (!field || !value) return { ok: false, reason: "invalid_answer" };
    rows.push({ field, value });
  }
  if (body.geography?.trim()) {
    rows.push({ field: "geography", value: body.geography.trim() });
  }
  if (!rows.length) return { ok: false, reason: "missing_answer" };
  if (!declared.length) return { ok: false, reason: "pending_field_required" };
  const allowed = new Set(declared);
  if (rows.some((row) => !allowed.has(row.field))) return { ok: false, reason: "extra_field" };
  const answers: ClarificationAnswerRow[] = [];
  for (const field of declared) {
    const values = [...new Set(rows.filter((row) => row.field === field).map((row) => row.value))];
    if (values.length === 0) return { ok: false, reason: "missing_answer" };
    if (values.length !== 1) return { ok: false, reason: "conflicting_values" };
    answers.push({ field, value: values[0]! });
  }
  return { ok: true, answers };
}
