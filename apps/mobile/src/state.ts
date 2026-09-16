export type RouteMode = "fixture" | "controlled-research";

export type ScreenName = "research" | "library" | "settings" | "source";

export type RunSnapshot = {
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

export type UiState = {
  tab: "research" | "library" | "settings";
  draft: string;
  consentGranted: boolean;
  signedIn: boolean;
  offline: boolean;
  routeMode: RouteMode;
  run: RunSnapshot | null;
  report: { reportId: string; blocks: ReportBlock[]; limitations: string[]; labeledDemo: boolean } | null;
  events: { sequence: number; type: string; publicSummary: string }[];
  source: { passageId: string; title: string; exactText: string; accessLevel: string } | null;
  readingAnchor: { reportId: string; blockId: string; offset: number } | null;
  error: string | null;
  status: "empty" | "loading" | "progress" | "completed" | "partial" | "failed" | "cancelled";
};

export function emptyState(): UiState {
  return {
    tab: "research",
    draft: "",
    consentGranted: false,
    signedIn: false,
    offline: false,
    routeMode: "fixture",
    run: null,
    report: null,
    events: [],
    source: null,
    readingAnchor: null,
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
  return { ...state, run: snap, status, error: null };
}

export function restoreAfterReopen(saved: UiState): UiState {
  return {
    ...saved,
    source: null,
    error: saved.offline ? "Offline. Saved draft and last report remain on this device." : null,
  };
}

export function canSubmit(state: UiState): { ok: boolean; reason?: string } {
  if (!state.draft.trim()) return { ok: false, reason: "Write a question first." };
  if (state.offline) return { ok: false, reason: "You are offline. The draft is saved and will not be sent." };
  if (!state.signedIn) return { ok: false, reason: "Sign in to start research. Your draft is kept." };
  if (!state.consentGranted) return { ok: false, reason: "Consent to AI processing is required before a live or fixture request is sent." };
  return { ok: true };
}

export function conciseBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const answer = blocks.find((b) => b.id === "answer");
  const caveats = blocks.filter((b) => b.kind === "caveat");
  return [answer, ...caveats].filter((b): b is ReportBlock => Boolean(b));
}
