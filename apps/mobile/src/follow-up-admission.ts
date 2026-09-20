import { mutatingFollowUpKey } from "./constraint-delta";
import { SupersededRequest } from "./request-scope";

export type PendingFollowUp = {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
  idempotencyKey: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function readPendingFollowUp(value: unknown): PendingFollowUp | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some((k) => !["parentRunId", "message", "expectedBriefRevision", "idempotencyKey"].includes(k)) ||
      typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId) ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 4000 ||
      typeof value.expectedBriefRevision !== "number" || !Number.isSafeInteger(value.expectedBriefRevision) || value.expectedBriefRevision <= 0 ||
      typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200)
    throw new Error("Saved follow-up request is invalid. Device cleanup is required before new research.");
  return {
    parentRunId: value.parentRunId,
    message: value.message.trim(),
    expectedBriefRevision: value.expectedBriefRevision,
    idempotencyKey: value.idempotencyKey,
  };
}

export function preparePendingFollowUp(args: {
  parentRunId: string;
  message: string;
  expectedBriefRevision: number;
}): PendingFollowUp {
  const message = args.message.trim();
  if (!message) throw new Error("Write a follow-up first.");
  return readPendingFollowUp({
    parentRunId: args.parentRunId,
    message,
    expectedBriefRevision: args.expectedBriefRevision,
    idempotencyKey: mutatingFollowUpKey(args.parentRunId, args.expectedBriefRevision, message),
  })!;
}

export async function submitPendingFollowUp<T>(pending: PendingFollowUp, io: {
  current(): boolean;
  save(value: PendingFollowUp): Promise<void>;
  post(parentRunId: string, message: string, expectedBriefRevision: number, idempotencyKey: string): Promise<T>;
}): Promise<T> {
  if (!io.current()) throw new SupersededRequest();
  const saved = readPendingFollowUp(pending);
  if (!saved) throw new Error("No saved follow-up request.");
  await io.save(saved);
  if (!io.current()) throw new SupersededRequest();
  return io.post(saved.parentRunId, saved.message, saved.expectedBriefRevision, saved.idempotencyKey);
}
