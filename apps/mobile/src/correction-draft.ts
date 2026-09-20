import { isConflictError, isExpiredSession } from "./api";
import { newFollowUpRequestId } from "./constraint-delta";
import { FOLLOW_UP_JOURNAL_PHASES, unresolvedJournalPhase, type FollowUpJournalPhase } from "./follow-up-admission";
import { SupersededRequest } from "./request-scope";
import { sha256Hex } from "./sha256";
import type { UiState } from "./state";

export type CorrectionDraft = {
  version: "correction-draft.v1";
  runId: string;
  baseRevision: number;
  question: string;
  evidencePolicy: "reuse_snapshot" | "refresh";
};
export function parseCorrectionDraft(value: unknown): CorrectionDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  if (Object.keys(d).some(k => !["version", "runId", "baseRevision", "question", "evidencePolicy"].includes(k)) ||
      d.version !== "correction-draft.v1" || typeof d.runId !== "string" || !d.runId || d.runId.length > 128 ||
      !Number.isSafeInteger(d.baseRevision) || (d.baseRevision as number) < 1 ||
      typeof d.question !== "string" || d.question.length > 20_000 ||
      (d.evidencePolicy !== "reuse_snapshot" && d.evidencePolicy !== "refresh")) return null;
  return d as CorrectionDraft;
}
export function activeCorrectionDraft(state: UiState): CorrectionDraft | null {
  return state.correctionDraft?.runId === state.run?.runId ? state.correctionDraft : null;
}
function currentBasis(state: UiState, runId: string, revision: number): boolean {
  return state.signedIn && state.run?.runId === runId && state.run.brief?.revision === revision &&
    Number.isSafeInteger(revision) && revision > 0;
}
/** Delayed input events cannot apply text to a different run/revision. Existing stale text retains its basis. */
export function editCorrectionDraft(state: UiState, runId: string, revision: number,
  patch: Partial<Pick<CorrectionDraft, "question" | "evidencePolicy">>): UiState {
  if (!currentBasis(state, runId, revision)) return state;
  const previous = activeCorrectionDraft(state) ?? { version: "correction-draft.v1" as const, runId,
    baseRevision: revision, question: "", evidencePolicy: "reuse_snapshot" as const };
  const next = parseCorrectionDraft({ ...previous, ...patch });
  return next ? { ...state, correctionDraft: next } : state;
}
/** Only an explicit review action may rebase preserved text to a newer server brief. */
export function rebaseCorrectionDraft(state: UiState, runId: string, revision: number): UiState {
  const draft = activeCorrectionDraft(state);
  return currentBasis(state, runId, revision) && draft
    ? { ...state, correctionDraft: { ...draft, baseRevision: revision } } : state;
}

export type PendingCorrection = {
  parentRunId: string;
  question: string;
  expectedBriefRevision: number;
  evidencePolicy: "reuse_snapshot" | "refresh";
  idempotencyKey: string;
  requestId: string;
  payloadDigest: string;
  phase: FollowUpJournalPhase;
  acceptedRunId?: string;
  acceptedBriefRevision?: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const correctionKeys = [
  "parentRunId", "question", "expectedBriefRevision", "evidencePolicy", "idempotencyKey",
  "requestId", "payloadDigest", "phase", "acceptedRunId", "acceptedBriefRevision",
];

export function correctionPayloadDigest(
  runId: string,
  revision: number,
  question: string,
  evidencePolicy: "reuse_snapshot" | "refresh",
): string {
  return sha256Hex(JSON.stringify({
    parentRunId: runId,
    expectedBriefRevision: revision,
    question: question.trim(),
    evidencePolicy,
  }));
}

export function mutatingCorrectionKey(
  runId: string,
  revision: number,
  question: string,
  evidencePolicy: "reuse_snapshot" | "refresh",
): string {
  return `${runId}-corr-${revision}-${correctionPayloadDigest(runId, revision, question, evidencePolicy)}`.slice(0, 200);
}

export function unresolvedCorrection(pending: PendingCorrection | null | undefined): boolean {
  return !!pending && unresolvedJournalPhase(pending.phase);
}

export function readPendingCorrection(value: unknown): PendingCorrection | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some((k) => !correctionKeys.includes(k)) ||
      typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId) ||
      typeof value.question !== "string" || !value.question.trim() || value.question.length > 20_000 ||
      typeof value.expectedBriefRevision !== "number" || !Number.isSafeInteger(value.expectedBriefRevision) || value.expectedBriefRevision <= 0 ||
      (value.evidencePolicy !== "reuse_snapshot" && value.evidencePolicy !== "refresh") ||
      typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200)
    throw new Error("Saved correction request is invalid. Device cleanup is required before new research.");
  const question = value.question.trim();
  const payloadDigest = typeof value.payloadDigest === "string" && value.payloadDigest.length === 64
    ? value.payloadDigest
    : correctionPayloadDigest(value.parentRunId, value.expectedBriefRevision, question, value.evidencePolicy);
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
    question,
    expectedBriefRevision: value.expectedBriefRevision,
    evidencePolicy: value.evidencePolicy,
    idempotencyKey: value.idempotencyKey,
    requestId,
    payloadDigest,
    phase,
    ...(acceptedRunId ? { acceptedRunId } : {}),
    ...(acceptedBriefRevision ? { acceptedBriefRevision } : {}),
  };
}

export function preparePendingCorrection(args: {
  parentRunId: string;
  question: string;
  expectedBriefRevision: number;
  evidencePolicy: "reuse_snapshot" | "refresh";
  requestId?: string;
}): PendingCorrection {
  const question = args.question.trim();
  if (!question) throw new Error("Write a correction first. The draft and last report stay on this device.");
  const requestId = args.requestId ?? newFollowUpRequestId();
  return readPendingCorrection({
    parentRunId: args.parentRunId,
    question,
    expectedBriefRevision: args.expectedBriefRevision,
    evidencePolicy: args.evidencePolicy,
    idempotencyKey: mutatingCorrectionKey(args.parentRunId, args.expectedBriefRevision, question, args.evidencePolicy),
    requestId,
    payloadDigest: correctionPayloadDigest(args.parentRunId, args.expectedBriefRevision, question, args.evidencePolicy),
    phase: "prepared",
  })!;
}

export function bindPendingCorrection(pending: PendingCorrection | null | undefined, args: {
  parentRunId: string;
  question: string;
  expectedBriefRevision: number;
  evidencePolicy: "reuse_snapshot" | "refresh";
}): PendingCorrection {
  const next = preparePendingCorrection(args);
  if (unresolvedCorrection(pending)) {
    if (pending!.idempotencyKey !== next.idempotencyKey) {
      throw new Error("Retry the saved correction before sending a different request.");
    }
    return readPendingCorrection(pending)!;
  }
  return next;
}

function withCorrectionPhase(
  pending: PendingCorrection,
  phase: FollowUpJournalPhase,
  extra: Partial<Pick<PendingCorrection, "acceptedRunId" | "acceptedBriefRevision">> = {},
): PendingCorrection {
  return readPendingCorrection({ ...pending, phase, ...extra })!;
}

export function readCorrectionBody(body: unknown): { runId: string; briefRevision?: number } {
  if (!record(body) || typeof body.runId !== "string" || !body.runId) {
    throw new Error("Correction was not accepted. Retry the saved request.");
  }
  return {
    runId: body.runId,
    ...(typeof body.briefRevision === "number" && Number.isSafeInteger(body.briefRevision) && body.briefRevision > 0
      ? { briefRevision: body.briefRevision }
      : {}),
  };
}

export async function runPendingCorrection(args: {
  pending: PendingCorrection | null | undefined;
  parentRunId: string;
  question: string;
  expectedBriefRevision: number;
  evidencePolicy: "reuse_snapshot" | "refresh";
  current(): boolean;
  save(value: PendingCorrection): Promise<void>;
  post(parentRunId: string, question: string, expectedBriefRevision: number, evidencePolicy: "reuse_snapshot" | "refresh", idempotencyKey: string): Promise<unknown>;
  adopt(body: { runId: string; briefRevision?: number }): Promise<void>;
}): Promise<PendingCorrection> {
  const check = () => { if (!args.current()) throw new SupersededRequest(); };
  check();
  let journal = bindPendingCorrection(args.pending, {
    parentRunId: args.parentRunId,
    question: args.question,
    expectedBriefRevision: args.expectedBriefRevision,
    evidencePolicy: args.evidencePolicy,
  });
  const save = async (value: PendingCorrection) => {
    journal = value;
    await args.save(value);
  };
  if (journal.phase === "prepared") {
    await save(journal);
    check();
  }
  try {
    if (journal.phase !== "accepted" && journal.phase !== "adopted") {
      journal = withCorrectionPhase(journal, "sent");
      await save(journal);
      check();
      const posting = readPendingCorrection(journal)!;
      const body = await args.post(
        posting.parentRunId,
        posting.question,
        posting.expectedBriefRevision,
        posting.evidencePolicy,
        posting.idempotencyKey,
      );
      check();
      const acceptedBody = readCorrectionBody(body);
      journal = withCorrectionPhase(journal, "accepted", {
        acceptedRunId: acceptedBody.runId,
        acceptedBriefRevision: acceptedBody.briefRevision,
      });
      await save(journal);
      check();
      await args.adopt(acceptedBody);
    } else if (journal.acceptedRunId) {
      await args.adopt({ runId: journal.acceptedRunId, briefRevision: journal.acceptedBriefRevision });
    } else {
      throw new Error("Correction was not accepted. Retry the saved request.");
    }
    check();
    journal = withCorrectionPhase(journal, "adopted", {
      acceptedRunId: journal.acceptedRunId,
      acceptedBriefRevision: journal.acceptedBriefRevision,
    });
    await save(journal);
    return journal;
  } catch (error) {
    if (error instanceof SupersededRequest || isExpiredSession(error)) throw error;
    if (isConflictError(error) && unresolvedJournalPhase(journal.phase) && journal.phase !== "accepted") {
      try { await save(withCorrectionPhase(journal, "rejected")); } catch { /* keep last durable phase */ }
    }
    throw error;
  }
}
