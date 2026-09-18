import { LifecycleSchema, PhaseSchema, TerminalOutcomeSchema, RequestedVerificationRequestSchema, type RequestedVerificationRequest } from "@deep/contracts";
import type { RunSnapshot } from "./state";
import { SupersededRequest } from "./request-scope";
export type PendingVerificationRequest = { parentRunId: string; request: RequestedVerificationRequest };
export type VerificationAccepted = { runId: string; parentRunId: string; verificationId: string; briefRevision: number;
  reused: boolean; reopenedDiscovery: false; evidencePolicy: RequestedVerificationRequest["evidencePolicy"] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Only the account-protected envelope may store this private note and stable identity. */
export function readPendingVerificationRequest(value: unknown): PendingVerificationRequest | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).some(k => !["parentRunId", "request"].includes(k)) ||
      typeof value.parentRunId !== "string" || !uuid.test(value.parentRunId))
    throw new Error("Saved verification request is invalid. Device cleanup is required before new research.");
  const request = RequestedVerificationRequestSchema.safeParse(value.request);
  if (!request.success) throw new Error("Saved verification request is invalid. Device cleanup is required before new research.");
  return { parentRunId: value.parentRunId, request: request.data };
}
export function prepareVerificationRequest(args: {
  run: { runId: string; reportId: string | null } | null;
  report: { reportId: string; version?: number; blocks: { claimIds: string[] }[] } | null;
  reportId: string; reportVersion: number; claimId: string; note: string;
  evidencePolicy: RequestedVerificationRequest["evidencePolicy"]; idempotencyKey: string;
  pendingAdmission?: unknown; pendingSourceDeletion?: string | null;
}): PendingVerificationRequest {
  if (args.pendingAdmission || args.pendingSourceDeletion) throw new Error("Resolve the saved request or source deletion before requesting verification.");
  if (!args.run || !args.report || args.run.reportId !== args.report.reportId || args.reportId !== args.report.reportId ||
      args.report.version !== args.reportVersion || !Number.isSafeInteger(args.reportVersion) || args.reportVersion <= 0 ||
      !args.report.blocks.some(block => block.claimIds.includes(args.claimId)))
    throw new Error("The selected report or claim changed. Reopen the report before requesting verification.");
  return readPendingVerificationRequest({ parentRunId: args.run.runId, request: {
    version: "requested-verification.v1", reportId: args.reportId, reportVersion: args.reportVersion,
    claimId: args.claimId, note: args.note, evidencePolicy: args.evidencePolicy, idempotencyKey: args.idempotencyKey,
  } })!;
}
export function readVerificationAccepted(value: unknown, pending: PendingVerificationRequest): VerificationAccepted {
  if (!record(value) || Object.keys(value).some(k => !["runId", "parentRunId", "verificationId", "briefRevision", "reused", "reopenedDiscovery", "evidencePolicy"].includes(k)) ||
      typeof value.runId !== "string" || !uuid.test(value.runId) || value.runId === pending.parentRunId ||
      value.parentRunId !== pending.parentRunId || typeof value.verificationId !== "string" || !uuid.test(value.verificationId) ||
      typeof value.briefRevision !== "number" || !Number.isSafeInteger(value.briefRevision) || value.briefRevision <= 0 ||
      typeof value.reused !== "boolean" || value.reopenedDiscovery !== false || value.evidencePolicy !== pending.request.evidencePolicy)
    throw new Error("Verification admission could not be confirmed. Retry the saved request.");
  return { runId: value.runId, parentRunId: pending.parentRunId, verificationId: value.verificationId,
    briefRevision: value.briefRevision, reused: value.reused, reopenedDiscovery: false, evidencePolicy: pending.request.evidencePolicy };
}
/** Never clears the journal: the caller must durably adopt the real child GET snapshot first. */
export async function submitVerificationRequest(pending: PendingVerificationRequest, io: {
  current(): boolean; save(value: PendingVerificationRequest): Promise<void>;
  post(parentRunId: string, request: RequestedVerificationRequest): Promise<unknown>;
}): Promise<VerificationAccepted> {
  const check = () => { if (!io.current()) throw new SupersededRequest(); };
  check();
  const saved = readPendingVerificationRequest(pending);
  if (!saved) throw new Error("No saved verification request.");
  // Separate parsed copies prevent caller edits from changing the acknowledged request.
  const posting = readPendingVerificationRequest(saved)!;
  await io.save(saved); check();
  const response = await io.post(posting.parentRunId, posting.request); check();
  return readVerificationAccepted(response, posting);
}

/** Validate the actual authenticated GET snapshot before clearing the saved admission identity. */
export function readVerificationRun(value: unknown, expectedRunId: string): RunSnapshot {
  const fail = () => new Error("Verification run could not be reopened. Retry the saved request.");
  if (!record(value) || !uuid.test(expectedRunId) || value.runId !== expectedRunId ||
      value.routeMode !== "controlled-research" || value.labeledDemo !== false ||
      (value.contentInvalidated !== undefined && value.contentInvalidated !== false) ||
      !LifecycleSchema.safeParse(value.lifecycle).success || !PhaseSchema.safeParse(value.phase).success ||
      !(value.reportId === null || typeof value.reportId === "string" && uuid.test(value.reportId)) ||
      !(value.outcome === null || TerminalOutcomeSchema.safeParse(value.outcome).success) ||
      (value.lifecycle === "terminal") !== (value.outcome !== null)) throw fail();
  let brief: RunSnapshot["brief"];
  if (value.brief !== undefined && value.brief !== null) {
    const b = value.brief;
    if (!record(b) || typeof b.originalQuestion !== "string" || !b.originalQuestion.trim() ||
        typeof b.revision !== "number" || !Number.isSafeInteger(b.revision) || b.revision <= 0 ||
        !Array.isArray(b.constraints) || !b.constraints.every(c => record(c) && typeof c.field === "string" && typeof c.value === "string")) throw fail();
    const assumptions = Array.isArray(b.assumptions)
      ? b.assumptions.filter((a): a is Record<string, unknown> => record(a) && typeof a.value === "string").map((a) => ({
        value: a.value as string,
        ...(typeof a.reversibility === "string" ? { reversibility: a.reversibility } : {}),
        ...(typeof a.userConfirmationState === "string" ? { userConfirmationState: a.userConfirmationState } : {}),
        ...(typeof a.impact === "string" ? { impact: a.impact } : {}),
      }))
      : undefined;
    brief = { originalQuestion: b.originalQuestion, revision: b.revision,
      constraints: b.constraints.map(c => ({ field: c.field as string, value: c.value as string,
        ...(typeof c.origin === "string" ? { origin: c.origin } : {}),
        ...(typeof c.importance === "string" ? { importance: c.importance } : {}) })),
      ...(typeof b.desiredOutcome === "string" ? { desiredOutcome: b.desiredOutcome } : {}),
      ...(typeof b.freshnessRequirements === "string" ? { freshnessRequirements: b.freshnessRequirements } : {}),
      ...(assumptions && assumptions.length ? { assumptions } : {}) };
  }
  const correctionMode = value.correctionMode;
  if (correctionMode !== undefined && correctionMode !== "legacy" && correctionMode !== "replace_question" && correctionMode !== "unavailable") throw fail();
  const reserve = value.correctionReserveMicro;
  if (reserve !== undefined && (typeof reserve !== "number" || !Number.isSafeInteger(reserve) || reserve < 0)) throw fail();
  return { runId: expectedRunId, lifecycle: LifecycleSchema.parse(value.lifecycle), phase: PhaseSchema.parse(value.phase),
    outcome: value.outcome === null ? null : TerminalOutcomeSchema.parse(value.outcome), reportId: value.reportId as string | null,
    labeledDemo: false, ...(brief ? { brief } : {}), ...(correctionMode ? { correctionMode } : {}),
    ...(typeof reserve === "number" ? { correctionReserveMicro: reserve } : {}) };
}
