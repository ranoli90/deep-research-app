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
