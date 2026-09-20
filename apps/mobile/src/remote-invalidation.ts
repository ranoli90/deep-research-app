import { SupersededRequest } from "./request-scope";
import type { RunSnapshot, UiState } from "./state";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readInvalidatedRun(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Saved content invalidation is invalid. Device cleanup is required.");
  return value;
}
/** Preserve independent input and exact request journals, but never keep deleted evidence content. */
export function redactInvalidatedContent(state: UiState, runId: string, cleanupPending = true): UiState {
  if (state.run?.runId !== runId) return state;
  return { ...state, status: state.run.lifecycle === "terminal" && state.run.outcome === "cancelled" ? "cancelled" : state.status,
    run: { ...state.run, brief: undefined, reportId: null, contentInvalidated: true },
    report: null, previousReport: null, source: null, correctionDraft: null, readingAnchor: null, followUpExplain: null,
    events: [], attachments: [], clarification: [], flagSent: false,
    pendingContentInvalidation: cleanupPending ? runId : null, error: "This research used a deleted source. Saved report content has been hidden." };
}
/** Invalidation outranks ancillary refresh failures; hide before durable cleanup and never fetch a deleted report. */
export async function applyRemoteInvalidation(state: UiState, snap: RunSnapshot, io: {
  current(): boolean; hide(): void; save(state: UiState, runId: string): Promise<void>;
}): Promise<boolean> {
  if (snap.contentInvalidated !== undefined && typeof snap.contentInvalidated !== "boolean") throw new Error("Run content status is invalid.");
  if (snap.contentInvalidated !== true) return false;
  const runId = readInvalidatedRun(snap.runId);
  const check = () => { if (!io.current() || state.run?.runId !== runId || !state.signedIn) throw new SupersededRequest(); };
  check(); io.hide(); check();
  const redacted = redactInvalidatedContent({ ...state, run: snap }, runId);
  await io.save(redacted, runId); check();
  return true;
}
