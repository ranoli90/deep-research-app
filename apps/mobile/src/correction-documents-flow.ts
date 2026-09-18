import { readAdmittedRun } from "./admission-retry";
import type { PendingCorrectionDocuments } from "./correction-documents";
import { SupersededRequest } from "./request-scope";
import { applySnapshot, type UiState, type AttachmentDraft } from "./state";
import { readVerificationRun } from "./verification-request";
export type CorrectionSelection = { owner: string | null; parent: string | null; files: AttachmentDraft[] };
export function correctionFilesFor(selection: CorrectionSelection, owner: string | null, parent: string | null): AttachmentDraft[] {
  return selection.owner === owner && selection.parent === parent ? selection.files : [];
}
export function adoptCorrectionFile(selection: CorrectionSelection, owner: string, parent: string | null, file: AttachmentDraft, current: () => boolean): CorrectionSelection {
  if (!current()) return selection;
  return { owner, parent, files: [...correctionFilesFor(selection, owner, parent), file] };
}
function check(current: () => boolean) { if (!current()) throw new SupersededRequest(); }
export async function authoritativeCorrection(expected: PendingCorrectionDocuments | null, parent: string, io: {
  current(): boolean; read(): Promise<PendingCorrectionDocuments | null>;
}): Promise<PendingCorrectionDocuments | null> {
  check(io.current); const durable = await io.read(); check(io.current);
  if ((expected && (!durable || durable.upload.key !== expected.upload.key || durable.parentRunId !== parent)) || (!expected && durable))
    throw new Error("Saved correction changed. Reopen the app before retrying.");
  return durable;
}
export async function resolveCorrectionDocuments(expected: PendingCorrectionDocuments, state: UiState, io: {
  current(): boolean; read(): Promise<PendingCorrectionDocuments | null>;
  resolve(pending: PendingCorrectionDocuments, ids: string[]): Promise<unknown>;
  finish(state: UiState): Promise<void>;
}): Promise<{ runId: string } | { state: UiState }> {
  const durable = (await authoritativeCorrection(expected, expected.parentRunId, io))!;
  const ids = durable.upload.uploads.map(u => u.attachmentId);
  // No POST can precede durable confirmation of every uploaded attachment ID.
  const result = ids.every((id): id is string => id !== null) ? await io.resolve(durable, ids) as Record<string, unknown> : { status: "withdrawn" };
  check(io.current);
  if (result?.status === "accepted") {
    const child = readAdmittedRun(result.run);
    if (child.runId === durable.parentRunId || child.labeledDemo) throw new Error("Invalid document correction recovery response.");
    return { runId: child.runId };
  }
  if (result?.status !== "withdrawn") throw new Error("Document correction status could not be confirmed. Retry checking the saved correction.");
  const next = { ...state, pendingCorrectionDocuments: null, error: "The document correction is withdrawn. Uploaded files remain in your account until deleted." };
  await io.finish(next); check(io.current);
  return { state: next };
}
/** Read actual owned state, then durably adopt it before clearing the request journal. */
export async function adoptCorrectionSnapshot(runId: string, state: UiState, io: {
  current(): boolean; get(): Promise<unknown>; finish(state: UiState): Promise<void>;
}): Promise<UiState> {
  check(io.current); const value = await io.get(); check(io.current);
  const snap = readVerificationRun(value, runId);
  if (snap.labeledDemo) throw new Error("Invalid document correction child route.");
  const next = applySnapshot({ ...state, pendingCorrectionDocuments: null, correctionDraft: null,
    previousReport: state.report ? { reportId: state.report.reportId, blocks: state.report.blocks } : state.previousReport,
    report: null, source: null, readingAnchor: null, events: [], offline: false, tab: "research" }, snap);
  await io.finish(next); check(io.current); return next;
}
