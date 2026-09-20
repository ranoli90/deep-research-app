import { mutatingFollowUpKey, followUpPayloadDigest, newFollowUpRequestId } from "./constraint-delta";
import { isConflictError, isExpiredSession } from "./api";
import { SupersededRequest } from "./request-scope";

export const FOLLOW_UP_JOURNAL_PHASES = ["prepared", "sent", "accepted", "adopted", "rejected", "withdrawn"] as const;
export type FollowUpJournalPhase = (typeof FOLLOW_UP_JOURNAL_PHASES)[number];
export const MUTATING_FOLLOW_UP_KINDS = ["deepen", "steer", "add_source", "change_constraint"] as const;
export type MutatingFollowUpKind = (typeof MUTATING_FOLLOW_UP_KINDS)[number];

export type PendingFollowUp = {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
  idempotencyKey: string;
  requestId: string;
  payloadDigest: string;
  phase: FollowUpJournalPhase;
  kind?: MutatingFollowUpKind;
  acceptedRunId?: string;
  acceptedBriefRevision?: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const allowedKeys = [
  "parentRunId", "message", "expectedBriefRevision", "idempotencyKey",
  "requestId", "payloadDigest", "phase", "kind", "acceptedRunId", "acceptedBriefRevision",
];

export function unresolvedJournalPhase(phase: string | null | undefined): boolean {
  return phase === "prepared" || phase === "sent" || phase === "accepted";
}

export function unresolvedFollowUp(pending: PendingFollowUp | null | undefined): boolean {
  return !!pending && unresolvedJournalPhase(pending.phase);
}

export function readPendingFollowUp(value: unknown): PendingFollowUp | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some((k) => !allowedKeys.includes(k)) ||
      typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId) ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 4000 ||
      typeof value.expectedBriefRevision !== "number" || !Number.isSafeInteger(value.expectedBriefRevision) || value.expectedBriefRevision <= 0 ||
      typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200)
    throw new Error("Saved follow-up request is invalid. Device cleanup is required before new research.");
  const message = value.message.trim();
  const payloadDigest = typeof value.payloadDigest === "string" && value.payloadDigest.length === 64
    ? value.payloadDigest
    : followUpPayloadDigest(value.parentRunId, value.expectedBriefRevision, message);
  const requestId = typeof value.requestId === "string" && uuid.test(value.requestId) ? value.requestId : newFollowUpRequestId();
  const phase = FOLLOW_UP_JOURNAL_PHASES.includes(value.phase as FollowUpJournalPhase)
    ? value.phase as FollowUpJournalPhase
    : "prepared";
  const kind = MUTATING_FOLLOW_UP_KINDS.includes(value.kind as MutatingFollowUpKind)
    ? value.kind as MutatingFollowUpKind
    : undefined;
  const acceptedRunId = typeof value.acceptedRunId === "string" && uuid.test(value.acceptedRunId) ? value.acceptedRunId : undefined;
  const acceptedBriefRevision = typeof value.acceptedBriefRevision === "number" && Number.isSafeInteger(value.acceptedBriefRevision) && value.acceptedBriefRevision > 0
    ? value.acceptedBriefRevision
    : undefined;
  return {
    parentRunId: value.parentRunId,
    message,
    expectedBriefRevision: value.expectedBriefRevision,
    idempotencyKey: value.idempotencyKey,
    requestId,
    payloadDigest,
    phase,
    ...(kind ? { kind } : {}),
    ...(acceptedRunId ? { acceptedRunId } : {}),
    ...(acceptedBriefRevision ? { acceptedBriefRevision } : {}),
  };
}

export function preparePendingFollowUp(args: {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
  kind?: MutatingFollowUpKind;
  requestId?: string;
}): PendingFollowUp {
  const message = args.message.trim();
  if (!message) throw new Error("Write a follow-up first.");
  const requestId = args.requestId ?? newFollowUpRequestId();
  return readPendingFollowUp({
    parentRunId: args.parentRunId,
    message,
    expectedBriefRevision: args.expectedBriefRevision,
    idempotencyKey: mutatingFollowUpKey(args.parentRunId, args.expectedBriefRevision, message),
    requestId,
    payloadDigest: followUpPayloadDigest(args.parentRunId, args.expectedBriefRevision, message),
    phase: "prepared",
    ...(args.kind ? { kind: args.kind } : {}),
  })!;
}

export function sameFollowUpMutation(pending: PendingFollowUp, args: {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
}): boolean {
  const message = args.message.trim();
  return pending.parentRunId === args.parentRunId
    && pending.message === message
    && pending.expectedBriefRevision === args.expectedBriefRevision
    && pending.idempotencyKey === mutatingFollowUpKey(args.parentRunId, args.expectedBriefRevision, message);
}

export function bindPendingFollowUp(pending: PendingFollowUp | null | undefined, args: {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
  kind?: MutatingFollowUpKind;
  requestId?: string;
}): PendingFollowUp {
  if (unresolvedFollowUp(pending)) {
    if (!sameFollowUpMutation(pending!, args)) {
      throw new Error("Retry the saved follow-up before sending a different request.");
    }
    return readPendingFollowUp(pending)!;
  }
  return preparePendingFollowUp(args);
}

export function withFollowUpPhase(
  pending: PendingFollowUp,
  phase: FollowUpJournalPhase,
  extra: Partial<Pick<PendingFollowUp, "acceptedRunId" | "acceptedBriefRevision">> = {},
): PendingFollowUp {
  return readPendingFollowUp({ ...pending, phase, ...extra })!;
}

export function readMutatingFollowUpBody(body: unknown): { runId: string; kind?: string; briefRevision?: number } {
  if (!record(body) || typeof body.runId !== "string" || !body.runId) {
    throw new Error("Follow-up was not accepted. Retry the saved request.");
  }
  return {
    runId: body.runId,
    ...(typeof body.kind === "string" ? { kind: body.kind } : {}),
    ...(typeof body.briefRevision === "number" && Number.isSafeInteger(body.briefRevision) && body.briefRevision > 0
      ? { briefRevision: body.briefRevision }
      : {}),
  };
}

export async function submitPendingFollowUp<T>(pending: PendingFollowUp, io: {
  current(): boolean;
  save(value: PendingFollowUp): Promise<void>;
  post(parentRunId: string, message: string, expectedBriefRevision: number, idempotencyKey: string): Promise<T>;
}): Promise<T> {
  if (!io.current()) throw new SupersededRequest();
  const saved = readPendingFollowUp(pending);
  if (!saved) throw new Error("No saved follow-up request.");
  if (saved.phase === "rejected" || saved.phase === "withdrawn") {
    throw new Error("Retry the saved follow-up before sending a different request.");
  }
  const posting = readPendingFollowUp(saved)!;
  const sending: PendingFollowUp = { ...posting, phase: posting.phase === "accepted" || posting.phase === "adopted" ? posting.phase : "sent" };
  await io.save(sending);
  if (!io.current()) throw new SupersededRequest();
  if ((saved.phase === "accepted" || saved.phase === "adopted") && saved.acceptedRunId) {
    return { kind: saved.kind, runId: saved.acceptedRunId, briefRevision: saved.acceptedBriefRevision } as T;
  }
  return io.post(posting.parentRunId, posting.message, posting.expectedBriefRevision, posting.idempotencyKey);
}

export async function withdrawPendingFollowUp(pending: PendingFollowUp, io: {
  current(): boolean;
  save(value: PendingFollowUp): Promise<void>;
}): Promise<PendingFollowUp> {
  if (!io.current()) throw new SupersededRequest();
  const saved = readPendingFollowUp(pending);
  if (!saved) throw new Error("No saved follow-up request.");
  if (saved.phase === "sent" || saved.phase === "accepted") {
    throw new Error("Retry the saved follow-up before sending a different request.");
  }
  const withdrawn = withFollowUpPhase(saved, "withdrawn");
  await io.save(withdrawn);
  return withdrawn;
}

export async function runMutatingFollowUp(args: {
  pending: PendingFollowUp | null | undefined;
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
  kind: MutatingFollowUpKind;
  current(): boolean;
  save(value: PendingFollowUp): Promise<void>;
  post(parentRunId: string, message: string, expectedBriefRevision: number, idempotencyKey: string): Promise<unknown>;
  adopt(body: { runId: string; kind?: string; briefRevision?: number }): Promise<void>;
}): Promise<PendingFollowUp> {
  const check = () => { if (!args.current()) throw new SupersededRequest(); };
  check();
  let journal = bindPendingFollowUp(args.pending, {
    parentRunId: args.parentRunId,
    message: args.message,
    expectedBriefRevision: args.expectedBriefRevision,
    kind: args.kind,
  });
  const save = async (value: PendingFollowUp) => {
    journal = value;
    await args.save(value);
  };
  if (journal.phase === "prepared") {
    await save(journal);
    check();
  }
  try {
    const body = await submitPendingFollowUp(journal, {
      current: args.current,
      save,
      post: args.post,
    });
    check();
    const acceptedBody = readMutatingFollowUpBody(body);
    journal = withFollowUpPhase(journal, "accepted", {
      acceptedRunId: acceptedBody.runId,
      acceptedBriefRevision: acceptedBody.briefRevision,
    });
    await save(journal);
    check();
    await args.adopt(acceptedBody);
    check();
    journal = withFollowUpPhase(journal, "adopted", {
      acceptedRunId: acceptedBody.runId,
      acceptedBriefRevision: acceptedBody.briefRevision,
    });
    await save(journal);
    return journal;
  } catch (error) {
    if (error instanceof SupersededRequest || isExpiredSession(error)) throw error;
    if (isConflictError(error) && unresolvedJournalPhase(journal.phase) && journal.phase !== "accepted") {
      try {
        await save(withFollowUpPhase(journal, "rejected"));
      } catch {
        /* keep the last durable phase when rejected cannot be persisted */
      }
    }
    throw error;
  }
}
