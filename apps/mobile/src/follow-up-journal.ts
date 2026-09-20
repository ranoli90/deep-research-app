import { followUpPayloadDigest, mutatingFollowUpKey } from "./constraint-delta";

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
const hexDigest = /^[a-f0-9]{64}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const allowedKeys = [
  "parentRunId", "message", "expectedBriefRevision", "idempotencyKey",
  "requestId", "payloadDigest", "phase", "kind", "acceptedRunId", "acceptedBriefRevision",
];
const DEVICE_CLEANUP = "Saved follow-up request is invalid. Device cleanup is required before new research.";

function fail(): never {
  throw new Error(DEVICE_CLEANUP);
}

export function unresolvedJournalPhase(phase: string | null | undefined): boolean {
  return phase === "prepared" || phase === "sent" || phase === "accepted";
}

export function unresolvedFollowUp(pending: PendingFollowUp | null | undefined): boolean {
  return !!pending && unresolvedJournalPhase(pending.phase);
}

export function readPendingFollowUp(value: unknown): PendingFollowUp | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some((k) => !allowedKeys.includes(k))) fail();
  if (typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId)) fail();
  if (typeof value.message !== "string" || !value.message.trim() || value.message.length > 4000) fail();
  if (typeof value.expectedBriefRevision !== "number" || !Number.isSafeInteger(value.expectedBriefRevision) || value.expectedBriefRevision <= 0) fail();
  if (typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200) fail();
  if (typeof value.requestId !== "string" || !uuid.test(value.requestId)) fail();
  if (typeof value.payloadDigest !== "string" || !hexDigest.test(value.payloadDigest)) fail();
  if (typeof value.phase !== "string" || !FOLLOW_UP_JOURNAL_PHASES.includes(value.phase as FollowUpJournalPhase)) fail();
  if (value.kind !== undefined && value.kind !== null && !MUTATING_FOLLOW_UP_KINDS.includes(value.kind as MutatingFollowUpKind)) fail();
  const message = value.message.trim();
  const parentRunId = value.parentRunId;
  const expectedBriefRevision = value.expectedBriefRevision;
  if (value.payloadDigest !== followUpPayloadDigest(parentRunId, expectedBriefRevision, message)) fail();
  if (value.idempotencyKey !== mutatingFollowUpKey(parentRunId, expectedBriefRevision, message)) fail();
  const phase = value.phase as FollowUpJournalPhase;
  const acceptedRunId = value.acceptedRunId === undefined || value.acceptedRunId === null
    ? undefined
    : typeof value.acceptedRunId === "string" && uuid.test(value.acceptedRunId)
      ? value.acceptedRunId
      : fail();
  const acceptedBriefRevision = value.acceptedBriefRevision === undefined || value.acceptedBriefRevision === null
    ? undefined
    : typeof value.acceptedBriefRevision === "number" && Number.isSafeInteger(value.acceptedBriefRevision) && value.acceptedBriefRevision > 0
      ? value.acceptedBriefRevision
      : fail();
  if (phase === "accepted" || phase === "adopted") {
    if (!acceptedRunId) fail();
  } else if (acceptedRunId !== undefined || acceptedBriefRevision !== undefined) {
    fail();
  }
  const kind = value.kind === undefined || value.kind === null ? undefined : value.kind as MutatingFollowUpKind;
  return {
    parentRunId,
    message,
    expectedBriefRevision,
    idempotencyKey: value.idempotencyKey,
    requestId: value.requestId,
    payloadDigest: value.payloadDigest,
    phase,
    ...(kind ? { kind } : {}),
    ...(acceptedRunId ? { acceptedRunId } : {}),
    ...(acceptedBriefRevision ? { acceptedBriefRevision } : {}),
  };
}

/** Reconstruct through the parser. Must not mint requestId or recompute digest/key. */
export function withFollowUpPhase(
  pending: PendingFollowUp,
  phase: FollowUpJournalPhase,
  extra: Partial<Pick<PendingFollowUp, "acceptedRunId" | "acceptedBriefRevision">> = {},
): PendingFollowUp {
  return readPendingFollowUp({ ...pending, phase, ...extra })!;
}
