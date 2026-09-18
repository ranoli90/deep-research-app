import type { UiState } from "./state";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export type SourceDeletionTarget = { sourceId: string; passageId: string; sourceVersionId?: string };
export type SourceDeletionReceipt = { deleted: true; sourceId: string; alreadyDeleted: boolean; invalidatedRunIds: string[]; fileCleanupPending: boolean };
export type SourceDeletionState = UiState & { pendingSourceDeletion: string | null };
export function readPendingSourceDeletion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Saved source deletion is invalid. Device cleanup is required before restoring private content.");
  return value;
}


/** Legacy source responses remain readable but cannot authorize a guessed deletion handle. */
export function sourceDeletionTarget(source: unknown): SourceDeletionTarget | null {
  if (!record(source) || typeof source.sourceId !== "string" || !uuid.test(source.sourceId) ||
    typeof source.passageId !== "string" || !uuid.test(source.passageId) ||
    (source.sourceVersionId != null && (typeof source.sourceVersionId !== "string" || !uuid.test(source.sourceVersionId)))) return null;
  return { sourceId: source.sourceId, passageId: source.passageId,
    ...(typeof source.sourceVersionId === "string" ? { sourceVersionId: source.sourceVersionId } : {}) };
}
export function sameSourceDeletionTarget(left: SourceDeletionTarget | null, right: SourceDeletionTarget | null): boolean {
  return !!left && !!right && left.sourceId === right.sourceId && left.passageId === right.passageId && left.sourceVersionId === right.sourceVersionId;
}
export function sourceDeletionUnavailable(args: { target: SourceDeletionTarget | null; offline: boolean; admissionPending: boolean; busy: boolean }): string | null {
  if (args.busy) return "Deleting source…";
  if (!args.target) return "Deletion is unavailable for this source reference.";
  if (args.admissionPending) return "Check or withdraw the saved research request before deleting a source.";
  if (args.offline) return "Connect to delete this source. Nothing has been deleted.";
  return null;
}
export function readSourceDeletionReceipt(value: unknown, expectedSourceId: string): SourceDeletionReceipt {
  if (!record(value) || Object.keys(value).some(key => !["deleted","sourceId","alreadyDeleted","invalidatedRunIds","fileCleanupPending"].includes(key)) ||
    value.deleted !== true || value.sourceId !== expectedSourceId || !uuid.test(expectedSourceId) || typeof value.alreadyDeleted !== "boolean" ||
    typeof value.fileCleanupPending !== "boolean" || !Array.isArray(value.invalidatedRunIds) || value.invalidatedRunIds.length > 10000 ||
    !value.invalidatedRunIds.every((id): id is string => typeof id === "string" && uuid.test(id)) || new Set(value.invalidatedRunIds).size !== value.invalidatedRunIds.length)
    throw new Error("Source deletion could not be confirmed. The source remains hidden on this device; retry when connected.");
  return { deleted:true, sourceId:expectedSourceId, alreadyDeleted:value.alreadyDeleted,
    invalidatedRunIds:[...value.invalidatedRunIds], fileCleanupPending:value.fileCleanupPending };
}
/** Persist this redacted snapshot without coalescing before issuing DELETE. Never drop unknown admission identity. */
export function prepareSourceDeletion(state: UiState & {pendingSourceDeletion?: string | null}, sourceId: string): SourceDeletionState {
  if (!state.signedIn) throw new Error("Sign in before deleting a source.");
  if (state.pendingSourceDeletion) throw new Error("Retry the pending source deletion before starting another.");
  const target = sourceDeletionTarget(state.source);
  const unavailable = sourceDeletionUnavailable({target,offline:state.offline,admissionPending:!!state.pendingAdmission,busy:false});
  if (unavailable) throw new Error(unavailable);
  if (target?.sourceId !== sourceId) throw new Error("The selected source changed. Review its deletion again.");
  return { ...state, pendingSourceDeletion:sourceId, tab:"research", run:null, report:null, previousReport:null, source:null,
    readingAnchor:null, correctionDraft:null, attachments:[], events:[], clarification:[], flagSent:false, status:"empty",
    error:"Source and cached reports are hidden on this device. Server deletion is not yet confirmed." };
}
/** Empty invalidatedRunIds on an idempotent reply does not restore previously hidden content. */
export function completeSourceDeletion(state: SourceDeletionState, receipt: SourceDeletionReceipt): SourceDeletionState {
  if (state.pendingSourceDeletion !== receipt.sourceId) return state;
  const confirmed = readSourceDeletionReceipt(receipt,state.pendingSourceDeletion);
  return { ...state, pendingSourceDeletion:null,
    error:confirmed.fileCleanupPending ? "Source deleted. Stored file cleanup is still pending. Other saved reports can be reopened from Library."
      : "Source deleted and dependent research invalidated. Other saved reports can be reopened from Library." };
}
