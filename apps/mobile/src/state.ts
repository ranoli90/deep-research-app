import type { PendingVerificationRequest } from "./verification-request";
import type { AdmissionDraft } from "./admission-retry";
import type { SourceDetail } from "./source-view";
import type { CorrectionDraft } from "./correction-draft";
export type RouteMode = "fixture" | "controlled-research";

export type ScreenName = "research" | "library" | "settings" | "source";

export type RunSnapshot = {
  correctionMode?: "legacy"|"replace_question"|"unavailable";
  correctionReserveMicro?:number;
  runId: string;
  lifecycle: string;
  phase: string;
  outcome: string | null;
  reportId: string | null;
  labeledDemo: boolean;
  brief?: { originalQuestion: string; constraints: { field: string; value: string }[]; revision: number };
};

export type ReportBlock = {
  id: string;
  kind: string;
  text: string;
  claimIds: string[];
  citationIds: string[];
};

export type AttachmentDraft = { id?: string; filename: string; mime: string } & ({ text: string; bytes?: never } | { bytes: Uint8Array; text?: never });

export type UiState = {
  tab: "research" | "library" | "settings";
  draft: string;
  correctionDraft: CorrectionDraft | null;
  pendingAdmission: AdmissionDraft | null;
  pendingSourceDeletion: string | null;
  pendingVerification: PendingVerificationRequest | null;
  consentGranted: boolean;
  signedIn: boolean;
  offline: boolean;
  routeMode: RouteMode;
  run: RunSnapshot | null;
  report: {
    reportId: string;
    version?: number;
    blocks: ReportBlock[];
    limitations: string[];
    labeledDemo: boolean;
    changeSummary?: { evidenceUpdated: boolean; conclusionChanged: boolean; newlyFeasible?: string[]; newlyInfeasible?: string[]; notes: string } | null;
  } | null;
  previousReport: { reportId: string; blocks: ReportBlock[] } | null;
  events: { sequence: number; type: string; publicSummary: string }[];
  source: SourceDetail | null;
  readingAnchor: { reportId: string; blockId: string; offset: number } | null;
  attachments: AttachmentDraft[];
  clarification: string[];
  flagSent: boolean;
  reducedMotion: boolean;
  error: string | null;
  status: "empty" | "loading" | "progress" | "completed" | "partial" | "failed" | "cancelled" | "awaiting_input";
};

export function emptyState(): UiState {
  return {
    tab: "research",
    draft: "",
    correctionDraft: null,
    pendingAdmission: null,
    pendingSourceDeletion: null,
    pendingVerification: null,
    consentGranted: false,
    signedIn: false,
    offline: false,
    routeMode: "fixture",
    run: null,
    report: null,
    events: [],
    source: null,
    readingAnchor: null,
    previousReport: null,
    attachments: [],
    clarification: [],
    flagSent: false,
    reducedMotion: false,
    error: null,
    status: "empty",
  };
}

export function applySnapshot(state: UiState, snap: RunSnapshot): UiState {
  let status: UiState["status"] = "progress";
  if (snap.lifecycle === "terminal" && snap.outcome === "completed") status = "completed";
  else if (snap.lifecycle === "terminal" && snap.outcome === "completed_with_limitations") status = "partial";
  else if (snap.lifecycle === "terminal" && snap.outcome === "cancelled") status = "cancelled";
  else if (snap.lifecycle === "terminal" && snap.outcome === "failed") status = "failed";
  else if (snap.lifecycle === "queued") status = "loading";
  else if (snap.lifecycle === "awaiting_input") status = "awaiting_input";
  return { ...state, run: snap, status, error: null };
}

export function restoreAfterReopen(saved: UiState): UiState {
  let status = saved.status;
  if (saved.report && (status === "progress" || status === "empty" || status === "loading")) {
    status = "completed";
  }
  return {
    ...saved,
    source: null,
    status,
    error: saved.offline ? "Offline. Saved draft and last report remain on this device." : null,
  };
}

export function canSubmit(state: UiState): { ok: boolean; reason?: string } {
  if (state.pendingVerification) return { ok: false, reason: "Resolve the saved verification request before starting research." };
  if (state.pendingSourceDeletion) return { ok: false, reason: "Confirm the pending source deletion before starting research." };
  if (!state.draft.trim()) return { ok: false, reason: "Write a question first." };
  if (state.offline) return { ok: false, reason: "You are offline. The draft is saved and will not be sent." };
  if (!state.signedIn) return { ok: false, reason: "Sign in to start research. Your draft is kept." };
  if (!state.consentGranted) return { ok: false, reason: "Consent to AI processing is required before a live or fixture request is sent." };
  return { ok: true };
}

export function conciseBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const ids = ["answer", "constraints", "eligibility"];
  const primary = ids.map((id) => blocks.find((b) => b.id === id)).filter((b): b is ReportBlock => Boolean(b));
  const caveats = blocks.filter((b) => b.kind === "caveat");
  return [...primary, ...caveats];
}

export function mergeEvents(
  existing: UiState["events"],
  incoming: UiState["events"],
): UiState["events"] {
  const bySeq = new Map<number, UiState["events"][number]>();
  for (const e of existing) bySeq.set(e.sequence, e);
  for (const e of incoming) bySeq.set(e.sequence, e);
  return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
}

export function restoreAnchor(
  saved: UiState["readingAnchor"],
  blocks: ReportBlock[],
): { anchor: UiState["readingAnchor"]; note?: string } {
  if (!saved) return { anchor: null };
  if (blocks.some((b) => b.id === saved.blockId)) return { anchor: saved };
  return { anchor: { ...saved, blockId: blocks[0]?.id ?? saved.blockId, offset: 0 }, note: "That section changed in the new version." };
}

export function closeSourceSheet(state: UiState): UiState {
  return { ...state, source: null };
}

export function androidBack(state: UiState): { consumed: boolean; next: UiState } {
  if (state.source) return { consumed: true, next: closeSourceSheet(state) };
  if (state.tab !== "research") return { consumed: true, next: { ...state, tab: "research" } };
  return { consumed: false, next: state };
}

export function logout(state: UiState): UiState {
  return { ...emptyState(), routeMode: state.routeMode };
}

export function attachFile(state: UiState, file: AttachmentDraft): UiState {
  if (state.attachments.length >= 3) {
    return { ...state, error: "Attachment limit is 3 files." };
  }
  if (!["text/plain", "text/markdown", "application/pdf"].includes(file.mime)) {
    return { ...state, error: "Only text, Markdown, and PDF are supported." };
  }
  if (state.pendingAdmission) {
    const target = state.pendingAdmission.uploads.find(u => !u.attachmentId && u.filename === file.filename && u.mime === file.mime &&
      u.kind === (file.bytes ? "bytes" : "text"));
    if (!target) return { ...state, error: "Select the exact original bytes for an unconfirmed document from the saved request. Other content cannot replace it." };
    // Reselection is bound by the asynchronous digest check at submission.
    // Names alone cannot identify a duplicate-named upload slot.
    const { id: _previousId, ...unbound } = file;
    file = unbound;
  }
  return { ...state, attachments: [...state.attachments, file], error: null };
}

export function submitPrerequisite(state: UiState): "research" | "settings" {
  if (!state.signedIn || !state.consentGranted) return "settings";
  return "research";
}

export function expireLocalSession(state: UiState): UiState {
  return {
    ...emptyState(),
    routeMode: state.routeMode,
    tab: "settings",
    error: "Session expired. Sign in again. Account data was cleared from this device.",
  };
}

/** Library tap must switch to Research and bind the run before the first poll tick. */
export function openLibraryItem(state: UiState, runId: string): UiState {
  return {
    ...state,
    tab: "research",
    source: null,
    error: null,
    status: "progress",
    run: {
      runId,
      lifecycle: "running",
      phase: state.run?.runId === runId ? state.run.phase : "researching",
      outcome: null,
      reportId: state.run?.runId === runId ? state.run.reportId : null,
      labeledDemo: state.routeMode === "fixture",
    },
  };
}
