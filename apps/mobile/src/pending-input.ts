import {
  AssumptionsRequestSchema,
  ClarificationFieldSchema,
  ContinueRunRequestSchema,
  PendingInputSchema,
  type AssumptionsRequest,
  type ContinueRunRequest,
  type PendingInput,
} from "@deep/contracts";
import { isConflictError, isExpiredSession } from "./api";
import { newFollowUpRequestId } from "./constraint-delta";
import { FOLLOW_UP_JOURNAL_PHASES, unresolvedJournalPhase, type FollowUpJournalPhase } from "./follow-up-admission";
import { SupersededRequest } from "./request-scope";
import { sha256Hex } from "./sha256";

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

export type PendingAssumptions = {
  parentRunId: string;
  action: "confirm" | "replace";
  values?: string[];
  expectedBriefRevision: number;
  idempotencyKey: string;
  requestId: string;
  payloadDigest: string;
  phase: FollowUpJournalPhase;
  acceptedRunId?: string;
  acceptedBriefRevision?: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const assumptionKeys = [
  "parentRunId", "action", "values", "expectedBriefRevision", "idempotencyKey",
  "requestId", "payloadDigest", "phase", "acceptedRunId", "acceptedBriefRevision",
];

export function assumptionsPayloadDigest(
  runId: string,
  revision: number,
  action: "confirm" | "replace",
  values: string[] = [],
): string {
  return sha256Hex(JSON.stringify({
    parentRunId: runId,
    expectedBriefRevision: revision,
    action,
    values,
  }));
}

export function mutatingAssumptionsKey(
  runId: string,
  revision: number,
  action: "confirm" | "replace",
  values: string[] = [],
): string {
  return `${runId}-assumptions-${revision}-${assumptionsPayloadDigest(runId, revision, action, values)}`.slice(0, 200);
}

export function unresolvedAssumptions(pending: PendingAssumptions | null | undefined): boolean {
  return !!pending && unresolvedJournalPhase(pending.phase);
}

export function readPendingAssumptions(value: unknown): PendingAssumptions | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some((k) => !assumptionKeys.includes(k)) ||
      typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId) ||
      (value.action !== "confirm" && value.action !== "replace") ||
      typeof value.expectedBriefRevision !== "number" || !Number.isSafeInteger(value.expectedBriefRevision) || value.expectedBriefRevision <= 0 ||
      typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200)
    throw new Error("Saved assumption request is invalid. Device cleanup is required before new research.");
  const values = Array.isArray(value.values) && value.values.every((row) => typeof row === "string")
    ? value.values.map((row) => row.trim()).filter(Boolean)
    : undefined;
  if (value.action === "replace" && !values?.length) throw new Error("Saved assumption request is invalid. Device cleanup is required before new research.");
  const payloadDigest = typeof value.payloadDigest === "string" && value.payloadDigest.length === 64
    ? value.payloadDigest
    : assumptionsPayloadDigest(value.parentRunId, value.expectedBriefRevision, value.action, values ?? []);
  const requestId = typeof value.requestId === "string" && uuid.test(value.requestId) ? value.requestId : newFollowUpRequestId();
  const phase = FOLLOW_UP_JOURNAL_PHASES.includes(value.phase as FollowUpJournalPhase)
    ? value.phase as FollowUpJournalPhase
    : "prepared";
  const acceptedRunId = typeof value.acceptedRunId === "string" && uuid.test(value.acceptedRunId) ? value.acceptedRunId : undefined;
  const acceptedBriefRevision = typeof value.acceptedBriefRevision === "number" && Number.isSafeInteger(value.acceptedBriefRevision) && value.acceptedBriefRevision > 0
    ? value.acceptedBriefRevision
    : undefined;
  return {
    parentRunId: value.parentRunId,
    action: value.action,
    ...(values ? { values } : {}),
    expectedBriefRevision: value.expectedBriefRevision,
    idempotencyKey: value.idempotencyKey,
    requestId,
    payloadDigest,
    phase,
    ...(acceptedRunId ? { acceptedRunId } : {}),
    ...(acceptedBriefRevision ? { acceptedBriefRevision } : {}),
  };
}

export function preparePendingAssumptions(args: {
  parentRunId: string;
  action: "confirm" | "replace";
  values?: string[];
  expectedBriefRevision: number;
  requestId?: string;
}): PendingAssumptions {
  const values = (args.values ?? []).map((row) => row.trim()).filter(Boolean);
  if (args.action === "replace" && !values.length) throw new Error("Enter the assumptions to keep.");
  const requestId = args.requestId ?? newFollowUpRequestId();
  return readPendingAssumptions({
    parentRunId: args.parentRunId,
    action: args.action,
    ...(args.action === "replace" ? { values } : {}),
    expectedBriefRevision: args.expectedBriefRevision,
    idempotencyKey: mutatingAssumptionsKey(args.parentRunId, args.expectedBriefRevision, args.action, args.action === "replace" ? values : []),
    requestId,
    payloadDigest: assumptionsPayloadDigest(args.parentRunId, args.expectedBriefRevision, args.action, args.action === "replace" ? values : []),
    phase: "prepared",
  })!;
}

export function bindPendingAssumptions(pending: PendingAssumptions | null | undefined, args: {
  parentRunId: string;
  action: "confirm" | "replace";
  values?: string[];
  expectedBriefRevision: number;
}): PendingAssumptions {
  const next = preparePendingAssumptions(args);
  if (unresolvedAssumptions(pending)) {
    if (pending!.idempotencyKey !== next.idempotencyKey) {
      throw new Error("Retry the saved assumption change before sending a different request.");
    }
    return readPendingAssumptions(pending)!;
  }
  return next;
}

function withAssumptionsPhase(
  pending: PendingAssumptions,
  phase: FollowUpJournalPhase,
  extra: Partial<Pick<PendingAssumptions, "acceptedRunId" | "acceptedBriefRevision">> = {},
): PendingAssumptions {
  return readPendingAssumptions({ ...pending, phase, ...extra })!;
}

export function readAssumptionsBody(body: unknown, requireRunId: boolean): { runId?: string; briefRevision?: number } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Assumption change was not accepted. Retry the saved request.");
  }
  const value = body as Record<string, unknown>;
  if (requireRunId && (typeof value.runId !== "string" || !value.runId)) {
    throw new Error("Assumption change was not accepted. Retry the saved request.");
  }
  return {
    ...(typeof value.runId === "string" && value.runId ? { runId: value.runId } : {}),
    ...(typeof value.briefRevision === "number" && Number.isSafeInteger(value.briefRevision) && value.briefRevision > 0
      ? { briefRevision: value.briefRevision }
      : {}),
  };
}

export async function runAssumptionsMutation(args: {
  pending: PendingAssumptions | null | undefined;
  parentRunId: string;
  action: "confirm" | "replace";
  values?: string[];
  expectedBriefRevision: number;
  current(): boolean;
  save(value: PendingAssumptions): Promise<void>;
  post(parentRunId: string, body: AssumptionsRequest, idempotencyKey: string): Promise<unknown>;
  adopt(body: { runId?: string; briefRevision?: number }): Promise<void>;
}): Promise<PendingAssumptions> {
  const check = () => { if (!args.current()) throw new SupersededRequest(); };
  check();
  let journal = bindPendingAssumptions(args.pending, {
    parentRunId: args.parentRunId,
    action: args.action,
    values: args.values,
    expectedBriefRevision: args.expectedBriefRevision,
  });
  const save = async (value: PendingAssumptions) => {
    journal = value;
    await args.save(value);
  };
  if (journal.phase === "prepared") {
    await save(journal);
    check();
  }
  const requireRunId = journal.action === "replace";
  try {
    if (journal.phase !== "accepted" && journal.phase !== "adopted") {
      journal = withAssumptionsPhase(journal, "sent");
      await save(journal);
      check();
      const posting = readPendingAssumptions(journal)!;
      const body = await args.post(
        posting.parentRunId,
        assumptionsRequest({
          action: posting.action,
          values: posting.values,
          expectedBriefRevision: posting.expectedBriefRevision,
        }),
        posting.idempotencyKey,
      );
      check();
      const acceptedBody = readAssumptionsBody(body, requireRunId);
      journal = withAssumptionsPhase(journal, "accepted", {
        acceptedRunId: acceptedBody.runId,
        acceptedBriefRevision: acceptedBody.briefRevision,
      });
      await save(journal);
      check();
      await args.adopt(acceptedBody);
    } else if (journal.acceptedRunId) {
      await args.adopt({ runId: journal.acceptedRunId, briefRevision: journal.acceptedBriefRevision });
    } else {
      await args.adopt({});
    }
    check();
    journal = withAssumptionsPhase(journal, "adopted", {
      acceptedRunId: journal.acceptedRunId,
      acceptedBriefRevision: journal.acceptedBriefRevision,
    });
    await save(journal);
    return journal;
  } catch (error) {
    if (error instanceof SupersededRequest || isExpiredSession(error)) throw error;
    if (isConflictError(error) && unresolvedJournalPhase(journal.phase) && journal.phase !== "accepted") {
      try { await save(withAssumptionsPhase(journal, "rejected")); } catch { /* keep last durable phase */ }
    }
    throw error;
  }
}
