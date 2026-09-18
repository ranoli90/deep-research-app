import { prepareAdmission, readAdmissionDraft, submitAdmission, type AdmissionDraft, type DocumentDigester } from "./admission-retry";
import type { AttachmentDraft } from "./state";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const note = "Add the selected documents to the existing research question.";
export type PendingCorrectionDocuments = {
  version: "correction-documents.v1"; parentRunId: string; baseRevision: number; upload: AdmissionDraft;
};
export function readCorrectionDocuments(value: unknown): PendingCorrectionDocuments | null {
  if (value == null) return null;
  const p = value as PendingCorrectionDocuments;
  if (typeof p !== "object" || Array.isArray(p) || Object.keys(p).some(k => !["version", "parentRunId", "baseRevision", "upload"].includes(k)) ||
    p.version !== "correction-documents.v1" || !uuid.test(p.parentRunId) || !Number.isSafeInteger(p.baseRevision) || p.baseRevision < 1)
    throw new Error("Saved document correction is invalid. Device cleanup is required.");
  const upload = readAdmissionDraft(p.upload);
  if (upload.routeMode !== "controlled-research" || upload.question !== note || !upload.uploads.length)
    throw new Error("Saved document correction is invalid. Device cleanup is required.");
  return { ...p, upload };
}
export async function prepareCorrectionDocuments(parentRunId: string, baseRevision: number, files: AttachmentDraft[], id: () => string,
  digest: DocumentDigester, current: () => boolean): Promise<PendingCorrectionDocuments> {
  const upload = await prepareAdmission(note, "controlled-research", files, id, digest, current);
  return readCorrectionDocuments({ version: "correction-documents.v1", parentRunId, baseRevision, upload })!;
}
/** Reuse the digest/upload pipeline, but never the ordinary research admission endpoint or journal. */
export async function submitCorrectionDocuments(pending: PendingCorrectionDocuments, files: AttachmentDraft[], io: {
  digest: DocumentDigester; current(): boolean; progress(message: string): void; preflight(): Promise<unknown>;
  save(pending: PendingCorrectionDocuments): Promise<void>; upload(file: AttachmentDraft, key: string): Promise<unknown>;
  correct(parentRunId: string, revision: number, text: string, ids: string[]): Promise<unknown>;
}): Promise<string> {
  const p = readCorrectionDocuments(pending)!;
  const child = await submitAdmission(p.upload, files, { ...io,
    preflight: async () => {
      const settings = await io.preflight();
      if (!settings || typeof settings !== "object" || Array.isArray(settings) || (settings as Record<string, unknown>).appendDocumentsAllowed !== true)
        throw new Error("Adding documents is unavailable on this server. No new upload or correction was sent. Check or withdraw a saved correction.");
      return settings;
    },
    save: upload => io.save({ ...p, upload }),
    admit: async (upload, ids) => {
      const result = await io.correct(p.parentRunId, p.baseRevision, upload.question, ids) as Record<string, unknown>;
      if (!result || typeof result.runId !== "string" || !uuid.test(result.runId) || result.runId === p.parentRunId ||
        result.parentRunId !== p.parentRunId || !Number.isSafeInteger(result.briefRevision) || (result.briefRevision as number) <= p.baseRevision || result.fullRerun !== true || typeof result.reused !== "boolean")
        throw new Error("Document correction could not be confirmed. Retry the saved correction.");
      return { runId: result.runId, lifecycle: "queued", phase: "preparing", labeledDemo: false };
    },
  });
  return child.runId;
}
