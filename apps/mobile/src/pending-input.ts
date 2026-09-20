import {
  AssumptionsRequestSchema,
  ClarificationFieldSchema,
  ContinueRunRequestSchema,
  PendingInputSchema,
  type AssumptionsRequest,
  type ContinueRunRequest,
  type PendingInput,
} from "@deep/contracts";

export function readPendingInput(value: unknown): PendingInput | null {
  if (value == null) return null;
  const parsed = PendingInputSchema.safeParse(value);
  if (!parsed.success) throw new Error("Pending input identity is invalid. Refresh the run before answering.");
  return parsed.data;
}

export function continueRunRequest(args: {
  pendingInput: PendingInput | null | undefined;
  value: string;
}): ContinueRunRequest {
  if (!args.pendingInput || args.pendingInput.type !== "clarification") {
    throw new Error("This run is not waiting for a clarification.");
  }
  const field = ClarificationFieldSchema.safeParse(args.pendingInput.field);
  if (!field.success) throw new Error("Refresh this run before answering. The typed clarification field is missing.");
  return ContinueRunRequestSchema.parse({
    pendingInputId: args.pendingInput.id,
    expectedBriefRevision: args.pendingInput.briefRevision,
    answers: [{ field: field.data, value: args.value }],
  });
}

export function assumptionsRequest(args: {
  action: "confirm" | "replace";
  values?: string[];
  expectedBriefRevision: number;
}): AssumptionsRequest {
  return AssumptionsRequestSchema.parse({
    action: args.action,
    expectedBriefRevision: args.expectedBriefRevision,
    ...(args.action === "replace" ? { values: args.values } : {}),
  });
}
