import { SupersededRequest } from "./request-scope";
import type { AttachmentDraft, RouteMode } from "./state";

export type AdmissionDraft = {
  version: "admission.v1"; key: string; question: string; routeMode: RouteMode;
  uploads: { key: string; filename: string; mime: string; kind: "bytes" | "text"; digest: string; attachmentId: string | null }[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readAdmissionDraft(value: unknown): AdmissionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Saved request is invalid. New research is disabled until device cleanup.");
  const d = value as AdmissionDraft;
  if (Object.keys(d).some(k => !["version", "key", "question", "routeMode", "uploads"].includes(k)) ||
    d.version !== "admission.v1" || !uuid.test(d.key) || typeof d.question !== "string" || !d.question.trim() || d.question.length > 20000 ||
    !["fixture", "controlled-research"].includes(d.routeMode) || !Array.isArray(d.uploads) || d.uploads.length > 3 ||
    d.uploads.some(u => !u || typeof u !== "object" || Object.keys(u).some(k => !["key", "filename", "mime", "kind", "digest", "attachmentId"].includes(k)) ||
      !uuid.test(u.key) || typeof u.digest !== "string" || !/^[0-9a-f]{64}$/.test(u.digest) || typeof u.filename !== "string" || !u.filename || u.filename.length > 180 ||
      !["application/pdf", "text/plain", "text/markdown"].includes(u.mime) || !["bytes", "text"].includes(u.kind) ||
      !(u.attachmentId === null || typeof u.attachmentId === "string" && uuid.test(u.attachmentId))) ||
    new Set(d.uploads.map(u => u.key)).size !== d.uploads.length) throw new Error("Saved request is invalid. New research is disabled until device cleanup.");
  return d;
}
export type DocumentDigester = (bytes: Uint8Array) => Promise<Uint8Array>;
function snapshotDocument(file: AttachmentDraft): AttachmentDraft {
  const length = file.bytes?.length ?? file.text?.length ?? 0;
  if (!length || length > 8 * 1024 * 1024) throw new Error("Documents must contain 1 byte to 8 MiB.");
  if (file.bytes) return { id: file.id, filename: file.filename, mime: file.mime, bytes: new Uint8Array(file.bytes) };
  return { ...file };
}
function checkCurrent(current: () => boolean) { if (!current()) throw new SupersededRequest(); }
async function yieldForDocument(current: () => boolean) {
  checkCurrent(current);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  checkCurrent(current);
}
async function fingerprintSnapshot(file: AttachmentDraft, digest: DocumentDigester, current: () => boolean): Promise<string> {
  checkCurrent(current);
  let bytes = file.bytes;
  if (!bytes) {
    const text = file.text ?? "", encoder = new TextEncoder(), chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (let offset = 0; offset < text.length;) {
      await yieldForDocument(current);
      let end = Math.min(offset + 2048, text.length);
      // Preserve the exact UTF-8 bytes used by the API, including surrogate pairs.
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const chunk = encoder.encode(text.slice(offset, end)); offset = end;
      totalBytes += chunk.length;
      if (totalBytes > 8 * 1024 * 1024) throw new Error("Documents must contain 1 byte to 8 MiB.");
      chunks.push(chunk);
    }
    bytes = new Uint8Array(totalBytes);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  }
  await yieldForDocument(current);
  const output = await digest(bytes);
  checkCurrent(current);
  // SDK54 Android hashing is synchronous native work behind a Promise wrapper.
  // Let queued account/view changes run before any persistence or network action.
  await yieldForDocument(current);
  if (!(output instanceof Uint8Array) || output.length !== 32) throw new Error("Document SHA256 is unavailable or invalid.");
  return Array.from(output, b => b.toString(16).padStart(2, "0")).join("");
}
export async function documentFingerprint(file: AttachmentDraft, digest: DocumentDigester, current: () => boolean = () => true): Promise<string> {
  checkCurrent(current);
  return fingerprintSnapshot(snapshotDocument(file), digest, current);
}
export async function prepareAdmission(question: string, routeMode: RouteMode, files: AttachmentDraft[], id: () => string, digestBytes: DocumentDigester,
  current: () => boolean = () => true): Promise<AdmissionDraft> {
  checkCurrent(current);
  const draft: AdmissionDraft = { version: "admission.v1", key: id(), question: question.trim(), routeMode, uploads: [] };
  for (const f of files) {
    const digest = await documentFingerprint(f, digestBytes, current);
    checkCurrent(current);
    draft.uploads.push({ key: id(), filename: f.filename, mime: f.mime, kind: f.bytes ? "bytes" : "text", digest, attachmentId: null });
  }
  return readAdmissionDraft(draft);
}
export type AdmittedRun = { runId: string; lifecycle: string; phase: string; labeledDemo: boolean };
export function readAdmittedRun(value: unknown): AdmittedRun {
  const v = value as AdmittedRun | null;
  if (!v || typeof v !== "object" || typeof v.runId !== "string" || !uuid.test(v.runId) ||
    !["queued", "running", "awaiting_input", "cancelling", "terminal"].includes(v.lifecycle) || typeof v.phase !== "string" || !v.phase || typeof v.labeledDemo !== "boolean")
    throw new Error("Research admission could not be confirmed. Retry the saved request.");
  return v;
}
/** Fresh authenticated route preflight precedes the journal; the journal precedes uploads/admission. It contains no document bytes. */
export async function submitAdmission(draft: AdmissionDraft, files: AttachmentDraft[], io: {
  digest: DocumentDigester;
  preflight(): Promise<unknown>;
  save(draft: AdmissionDraft): Promise<void>;
  upload(file: AttachmentDraft, key: string): Promise<unknown>;
  admit(draft: AdmissionDraft, attachmentIds: string[]): Promise<unknown>;
  current(): boolean; progress(message: string): void;
}): Promise<AdmittedRun> {
  let saved = readAdmissionDraft(draft);
  const check = () => { if (!io.current()) throw new SupersededRequest(); };
  check();
  io.progress("Checking research availability…");
  const settings = await io.preflight(); check();
  const flag = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)[saved.routeMode === "fixture" ? "fixtureRouteAllowed" : "liveRouteEnabled"] : undefined;
  if (flag !== true) throw new Error(flag === false
    ? "This research mode is disabled on the server. No new upload or research request was sent. Use Check or withdraw for a saved request."
    : "Could not confirm availability for this research mode. No new upload or research request was sent. Retry, or use Check or withdraw for a saved request.");
  const used = new Set<number>();
  const candidates = new Map<number, { file: AttachmentDraft; digest: string }>();
  const selected = new Map<number, AttachmentDraft>();
  // Validate immutable candidate snapshots before saving or sending anything. A
  // caller mutating its Uint8Array during a yield cannot change uploaded bytes.
  for (let i = 0; i < saved.uploads.length; i++) {
    const upload = saved.uploads[i]!;
    if (upload.attachmentId) continue;
    for (let n = 0; n < files.length; n++) {
      const f = files[n]!;
      if (used.has(n) || f.filename !== upload.filename || f.mime !== upload.mime ||
        (f.bytes ? "bytes" : "text") !== upload.kind || (f.id && f.id !== upload.key)) continue;
      let candidate = candidates.get(n);
      if (!candidate) {
        io.progress(`Checking document ${i + 1} of ${saved.uploads.length}…`);
        const file = snapshotDocument(f);
        candidate = { file, digest: await fingerprintSnapshot(file, io.digest, io.current) };
        candidates.set(n, candidate);
      }
      check();
      if (candidate.digest !== upload.digest) continue;
      used.add(n); selected.set(i, candidate.file); break;
    }
    if (!selected.has(i)) throw new Error(`Select ${upload.filename} again to retry the saved request. Previously confirmed uploads will be reused.`);
  }
  await io.save(saved); check();
  for (let i = 0; i < saved.uploads.length; i++) {
    const upload = saved.uploads[i]!;
    if (upload.attachmentId) continue;
    check(); io.progress(`Uploading document ${i + 1} of ${saved.uploads.length}…`);
    const result = await io.upload(selected.get(i)!, upload.key) as { attachmentId?: unknown }; check();
    if (!result || typeof result.attachmentId !== "string" || !uuid.test(result.attachmentId)) throw new Error("Document upload could not be confirmed. Retry the saved request.");
    saved = { ...saved, uploads: saved.uploads.map((u, n) => n === i ? { ...u, attachmentId: result.attachmentId as string } : u) };
    await io.save(saved); check();
  }
  io.progress("Starting research…");
  const result = await io.admit(saved, saved.uploads.map(u => u.attachmentId!)); check();
  return readAdmittedRun(result);
}
