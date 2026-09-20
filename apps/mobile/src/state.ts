import { redactInvalidatedContent } from "./remote-invalidation";
import type { FollowUpExplain } from "./follow-up-explain";
import type { PendingFollowUp } from "./follow-up-admission";
import type { PendingVerificationRequest } from "./verification-request";
import { readPendingInput } from "./pending-input";
import type { AdmissionDraft } from "./admission-retry";
import type { SourceDetail } from "./source-view";
import type { CorrectionDraft } from "./correction-draft";
import { adoptPublicEvents, type ResearchEvent } from "./research-activity";
export type RouteMode = "fixture" | "controlled-research";

export type ScreenName = "research" | "library" | "settings" | "source";

export type RunSnapshot = {
  contentInvalidated?: boolean;
  correctionMode?: "legacy"|"replace_question"|"unavailable";
  correctionReserveMicro?:number;
  runId: string;
  lifecycle: string;
  phase: string;
  outcome: string | null;
  reportId: string | null;
  labeledDemo: boolean;
  brief?: {
    originalQuestion: string;
    constraints: { field: string; value: string; origin?: string; importance?: string }[];
    revision: number;
    desiredOutcome?: string;
    geography?: string;
    freshnessRequirements?: string;
    materialClarification?: boolean;
    assumptions?: { value: string; reversibility?: string; userConfirmationState?: string; impact?: string }[];
  };
  pendingQueryAuthorization?: {
    id: string;
    proposedQuery: string;
    queryDigest: string;
    briefRevision: number;
    terms: string[];
    reason?: string | null;
  } | null;
  pendingInput?: {
    id: string;
    type: "clarification" | "query_authorization";
    briefRevision: number;
    field?: "geography" | "budget" | "use_case" | "population" | "timeframe" | "platform" | "private_search" | "subject" | "currency" | "safety";
  } | null;
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
  pendingContentInvalidation: string | null;
  pendingCorrectionDocuments: import("./correction-documents").PendingCorrectionDocuments | null;
  tab: "research" | "library" | "settings";
  draft: string;
  correctionDraft: CorrectionDraft | null;
  pendingAdmission: AdmissionDraft | null;
  pendingSourceDeletion: string | null;
  pendingVerification: PendingVerificationRequest | null;
  pendingFollowUp: PendingFollowUp | null;
  consentGranted: boolean;
  signedIn: boolean;
  offline: boolean;
  routeMode: RouteMode;
  run: RunSnapshot | null;
  report: {
    reportId: string;
    version?: number;
    blocks: ReportBlock[];
    claims?: { id: string; text: string }[];
    limitations: string[];
    labeledDemo: boolean;
    changeSummary?: { evidenceUpdated: boolean; conclusionChanged: boolean; newlyFeasible?: string[]; newlyInfeasible?: string[]; notes: string } | null;
  } | null;
  previousReport: { reportId: string; blocks: ReportBlock[] } | null;
  events: ResearchEvent[];
  source: SourceDetail | null;
  readingAnchor: { reportId: string; blockId: string; offset: number } | null;
  attachments: AttachmentDraft[];
  clarification: string[];
  flagSent: boolean;
  reducedMotion: boolean;
  followUpExplains: FollowUpExplain[];
  error: string | null;
  status: "empty" | "loading" | "progress" | "completed" | "partial" | "failed" | "cancelled" | "awaiting_input";
};

export function emptyState(): UiState {
  return {
    pendingContentInvalidation: null,
    tab: "research",
    draft: "",
    correctionDraft: null,
    pendingCorrectionDocuments: null,
    pendingAdmission: null,
    pendingSourceDeletion: null,
    pendingVerification: null,
    pendingFollowUp: null,
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
    followUpExplains: [],
    error: null,
    status: "empty",
  };
}

export function applySnapshot(state: UiState, snap: RunSnapshot): UiState {
  const pendingInput = snap.pendingInput === undefined ? undefined : snap.pendingInput === null ? null : readPendingInput(snap.pendingInput);
  const run: RunSnapshot = pendingInput === undefined ? snap : { ...snap, pendingInput };
  let status: UiState["status"] = "progress";
  if (run.lifecycle === "terminal" && run.outcome === "completed") status = "completed";
  else if (run.lifecycle === "terminal" && run.outcome === "completed_with_limitations") status = "partial";
  else if (run.lifecycle === "terminal" && run.outcome === "cancelled") status = "cancelled";
  else if (run.lifecycle === "terminal" && run.outcome === "failed") status = "failed";
  else if (run.lifecycle === "queued") status = "loading";
  else if (run.lifecycle === "awaiting_input") status = "awaiting_input";
  const next = {
    ...state,
    run,
    status,
    error: null,
    followUpExplains: state.followUpExplains.filter((row) => row.runId === run.runId),
    pendingFollowUp: state.pendingFollowUp?.parentRunId === run.runId ? state.pendingFollowUp : null,
  };
  return run.contentInvalidated === true ? redactInvalidatedContent(next, run.runId) : next;
}

/** The owned run lifecycle outranks cached screen status when describing current work. */
export function researchActivity(state: Pick<UiState, "run" | "report" | "pendingContentInvalidation">): { inProgress: boolean; terminalNotice: string | null } {
  const run = state.run;
  if (!run) return { inProgress: false, terminalNotice: null };
  if (run.contentInvalidated === true) return { inProgress: false, terminalNotice: "This report is unavailable because a source was deleted." };
  if (run.lifecycle !== "terminal") return {
    inProgress: !state.pendingContentInvalidation && ["queued", "running", "cancelling", "awaiting_input"].includes(run.lifecycle), terminalNotice: null,
  };
  // Failed/cancelled one-liners are owned by researchStatusLine; keep a notice only when no report exists.
  if (run.outcome === "cancelled") return { inProgress: false, terminalNotice: state.report ? null : "Research cancelled." };
  if (run.outcome === "failed") return { inProgress: false, terminalNotice: state.report ? null : "Research failed." };
  return { inProgress: false, terminalNotice: state.report ? null : "Research has ended. No report is available." };
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

/** After a report, the composer continues this research instead of starting a leftover new run. */
export function composerFollowsReport(state: Pick<UiState, "report" | "run" | "status" | "pendingContentInvalidation" | "pendingAdmission">): boolean {
  if (!state.report || state.pendingContentInvalidation || state.pendingAdmission) return false;
  if (state.run?.contentInvalidated === true) return false;
  if (state.run?.lifecycle !== "terminal") return false;
  return state.status === "completed" || state.status === "partial";
}

export function startNewResearch(state: UiState): { ok: true; next: UiState } | { ok: false; reason: string } {
  if (state.pendingContentInvalidation) return { ok: false, reason: "Retry clearing deleted source content before starting new research." };
  if (state.pendingCorrectionDocuments) return { ok: false, reason: "Retry the saved document correction before starting new research." };
  if (state.pendingVerification) return { ok: false, reason: "Resolve the saved verification request before starting new research." };
  if (state.pendingFollowUp) return { ok: false, reason: "Retry the saved follow-up before starting new research." };
  if (state.pendingSourceDeletion) return { ok: false, reason: "Confirm the pending source deletion before starting new research." };
  if (state.pendingAdmission) return { ok: false, reason: "Check or withdraw the saved request before starting new research." };
  return {
    ok: true,
    next: {
      ...state,
      tab: "research",
      draft: "",
      run: null,
      report: null,
      previousReport: null,
      events: [],
      followUpExplains: [],
      pendingFollowUp: null,
      source: null,
      readingAnchor: null,
      correctionDraft: null,
      attachments: [],
      clarification: [],
      flagSent: false,
      error: null,
      status: "empty",
    },
  };
}

export function canSubmit(state: UiState): { ok: boolean; reason?: string } {
  if (state.pendingContentInvalidation) return { ok: false, reason: "Retry clearing deleted source content before starting research." };
  if (state.pendingCorrectionDocuments) return { ok: false, reason: "Retry the saved document correction before starting research." };
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
  return adoptPublicEvents([...existing, ...incoming]);
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
  if (state.run || state.report || state.pendingAdmission || state.draft.trim()) {
    const started = startNewResearch(state);
    if (started.ok) return { consumed: true, next: started.next };
    return { consumed: true, next: { ...state, error: started.reason } };
  }
  return { consumed: true, next: state };
}

/** Decide synchronously; React may defer the state updater until after Back returns. Never leak to the previous Android activity. */
export function handleAndroidBack(state: UiState, update: (updater: (previous: UiState) => UiState) => void, closeSource: () => void): boolean {
  if (state.source) { closeSource(); return true; }
  update(previous => androidBack(previous).next);
  return true;
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
  const same = state.run?.runId === runId;
  return {
    ...state,
    tab: "research",
    source: null,
    error: null,
    status: same ? state.status : "loading",
    draft: same || !state.run ? state.draft : "",
    report: same ? state.report : null,
    previousReport: same ? state.previousReport : null,
    events: same ? state.events : [],
    readingAnchor: same ? state.readingAnchor : null,
    run: {
      runId,
      lifecycle: same ? state.run!.lifecycle : "loading",
      phase: same ? state.run!.phase : "loading",
      outcome: same ? state.run!.outcome : null,
      reportId: same ? state.run!.reportId : null,
      labeledDemo: same ? state.run!.labeledDemo : false,
    },
  };
}
