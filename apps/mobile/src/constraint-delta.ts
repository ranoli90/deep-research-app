import { sha256Hex } from "./sha256";
import { SupersededRequest } from "./request-scope";

function requestId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function followUpPayloadDigest(runId: string, revision: number, message: string): string {
  return sha256Hex(JSON.stringify({
    parentRunId: runId,
    expectedBriefRevision: revision,
    message: message.trim(),
  }));
}

export function mutatingFollowUpKey(runId: string, revision: number, message: string): string {
  const digest = followUpPayloadDigest(runId, revision, message);
  return `${runId}-followup-${revision}-${digest}`.slice(0, 200);
}

export function newFollowUpRequestId(): string {
  return requestId();
}

export type ViewHandle = {
  current(): boolean;
  release(): void;
};

export type AcceptedChildHandoff = {
  captureView(runId: string): ViewHandle;
  onView(view: ViewHandle): void;
  currentRun(runId: string): boolean;
};

/**
 * Persist a mutation phase before exposing it to the accepted-child flow.
 * React publication may be deferred, so the authoritative ref is advanced
 * synchronously after the durable write while the selected run is still owned.
 */
export async function persistOwnedJournalSnapshot<T extends object, K extends keyof T>(args: {
  field: K;
  saved: T[K];
  currentState(): T;
  persist(state: T): Promise<void>;
  current(): boolean;
  stillOwned(): boolean;
  synchronize(state: T): void;
  render(saved: T[K]): void;
}): Promise<void> {
  const durable = { ...args.currentState(), [args.field]: args.saved } as T;
  await args.persist(durable);
  const owned = args.stillOwned();
  if (owned) {
    // Merge only the durable journal field into the newest state. Consent or
    // another account-scoped update may have completed while storage awaited.
    args.synchronize({ ...args.currentState(), [args.field]: args.saved } as T);
  }
  if (!owned || !args.current()) throw new SupersededRequest();
  args.render(args.saved);
}

/** Revoke consent without allowing account-A state to publish after its session ends. */
export async function revokeConsentWithinAccount<T extends { consentGranted: boolean; consentRevision: number; error: string | null }>(args: {
  account: ViewHandle;
  currentState(): T;
  invalidateView(): void;
  waitForJournal(): Promise<void>;
  persist(state: T): Promise<void>;
  revokeRemote(): Promise<void>;
  synchronize(state: T): void;
  render(state: T): void;
  failureMessage: string;
}): Promise<void> {
  const ensureCurrent = () => { if (!args.account.current()) throw new SupersededRequest(); };
  // Each confirmed revocation advances the monotonic revision so a render echo
  // of the pre-revocation frame can never resurrect consent.
  const revokedState = (state: T): T => ({ ...state, consentGranted: false, consentRevision: (state.consentRevision ?? 0) + 1 });
  const publish = (next: T) => {
    ensureCurrent();
    args.synchronize(next);
    args.render(next);
  };
  try {
    ensureCurrent();
    args.invalidateView();
    ensureCurrent();
    publish(revokedState(args.currentState()));
    await args.waitForJournal();
    ensureCurrent();
    const revoked = revokedState(args.currentState());
    await args.persist(revoked);
    ensureCurrent();
    publish(revoked);
    await args.revokeRemote();
    ensureCurrent();
  } catch (error) {
    if (!args.account.current() || error instanceof SupersededRequest) throw new SupersededRequest();
    publish({ ...revokedState(args.currentState()), error: args.failureMessage });
  }
}

/** Child identity from a mutating follow-up or assumption replace; never poll the parent when a child is returned. */
export async function adoptReturnedChild(args: {
  parentRunId: string;
  body: { runId?: unknown; kind?: unknown };
  requireRunId?: boolean;
  selectRun: (runId: string) => void;
  refresh: (runId: string) => Promise<void>;
  poll: (runId: string) => void;
  captureView?: AcceptedChildHandoff["captureView"];
  onView?: AcceptedChildHandoff["onView"];
  currentRun?: AcceptedChildHandoff["currentRun"];
}): Promise<string> {
  if (args.requireRunId && (typeof args.body.runId !== "string" || !args.body.runId)) {
    throw new Error("Follow-up was not accepted. Retry the saved request.");
  }
  const runId = typeof args.body.runId === "string" && args.body.runId ? args.body.runId : args.parentRunId;
  const handoffCount = Number(!!args.captureView) + Number(!!args.onView) + Number(!!args.currentRun);
  if (handoffCount !== 0 && handoffCount !== 3) {
    throw new Error("Accepted child transition is unavailable. Retry the saved request.");
  }
  if (handoffCount && !args.currentRun!(args.parentRunId)) throw new SupersededRequest();
  let adoptedView: ViewHandle | null = null;
  if (runId !== args.parentRunId) {
    args.selectRun(runId);
    if (args.currentRun && !args.currentRun(runId)) throw new SupersededRequest();
    if (args.captureView && args.onView) {
      adoptedView = args.captureView(runId);
      if (!adoptedView.current()) {
        adoptedView.release();
        throw new SupersededRequest();
      }
      try {
        args.onView(adoptedView);
      } catch (error) {
        adoptedView.release();
        throw error;
      }
    }
  }
  await args.refresh(runId);
  if (adoptedView && (!adoptedView.current() || !args.currentRun?.(runId))) throw new SupersededRequest();
  if (runId !== args.parentRunId) args.poll(runId);
  return runId;
}
