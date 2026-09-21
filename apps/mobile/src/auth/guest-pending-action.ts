import { sha256Hex } from "../sha256";

/**
 * The client-side half of the guest-to-member handoff journal. This is not an
 * authorization mechanism: the API owns admission, claim, capability, budget,
 * and idempotency. Keeping the envelope strict prevents a late OAuth callback
 * from silently changing or submitting a different local action.
 */
export const GUEST_PENDING_ACTION_VERSION = "guest-pending-action.v2" as const;
export const GUEST_PENDING_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Uuid = string;
type Digest = string;
export type GuestPendingActionPhase =
  | "pending_auth"
  | "authenticating"
  | "authenticated"
  | "claim_pending"
  | "claimed"
  | "resume_pending"
  | "dispatched"
  | "dismissed"
  | "cancelled"
  | "rejected"
  | "expired";
export type GuestAuthProvider = "apple" | "google" | "email";
export type GuestPendingActionKind = "new_research" | "follow_up" | "clarification";

export type GuestPendingActionPayload =
  | { kind: "new_research"; text: string }
  | { kind: "follow_up"; text: string; parentRunId: Uuid }
  | { kind: "clarification"; text: string; pendingInputId: Uuid; briefRevision: number; field: string };

export type GuestPendingAction = {
  version: typeof GUEST_PENDING_ACTION_VERSION;
  phase: GuestPendingActionPhase;
  /** True only until a user explicitly dismisses/cancels automatic continuation. */
  autoResume: boolean;
  submissionId: Uuid;
  guestContextId: Uuid;
  conversationId: Uuid;
  conversationVersion: number;
  draftRevision: number;
  draftDigest: Digest;
  payload: GuestPendingActionPayload;
  payloadDigest: Digest;
  consentPolicyVersion: string;
  createdAt: string;
  expiresAt: string;
  authAttempt: { id: Uuid; provider: GuestAuthProvider } | null;
  authenticatedAccountId: Uuid | null;
  claim: { requestId: Uuid; accountId: Uuid; controlVersion: number; principalEpoch: number; viewEpoch: number } | null;
  dispatchReceiptId: Uuid | null;
  rejectionCode: "guest_expired" | "guest_deleted" | "authority_denied" | "intent_stale" | null;
};

export type NewGuestPendingAction = Omit<GuestPendingAction,
  "version" | "phase" | "autoResume" | "payloadDigest" | "authAttempt" | "authenticatedAccountId" | "claim" | "dispatchReceiptId" | "rejectionCode">;

export type CurrentResumeContext = {
  now: Date;
  accountId: Uuid;
  sessionActive: boolean;
  guestContextId: Uuid;
  conversationId: Uuid;
  conversationVersion: number;
  controlVersion: number;
  /** Changes only when the authenticated principal changes, never on token refresh. */
  principalEpoch: number;
  /** Changes when the active conversation/view changes. */
  viewEpoch: number;
  /** Token refresh tracking only; it is deliberately not a continuation binding. */
  credentialGeneration: number;
  draftRevision: number;
  draftDigest: Digest;
  consentPolicyVersion: string;
  authorityAllowed: boolean;
  budgetAllowed: boolean;
};

export type ResumeValidation = { ok: true } | { ok: false; code: "expired" | "phase" | "dismissed" | "account" | "session" | "claim" | "principal" | "view" | "draft" | "consent" | "authority" | "budget" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const phases = new Set<GuestPendingActionPhase>([
  "pending_auth", "authenticating", "authenticated", "claim_pending", "claimed", "resume_pending", "dispatched", "dismissed", "cancelled", "rejected", "expired",
]);
const actionKeys: Record<GuestPendingActionKind, readonly string[]> = {
  new_research: ["kind", "text"],
  follow_up: ["kind", "text", "parentRunId"],
  clarification: ["kind", "text", "pendingInputId", "briefRevision", "field"],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function invalid(): never { throw new Error("Saved sign-in action is invalid. Keep the draft and send it again."); }
function validText(value: unknown): value is string { return typeof value === "string" && value.length <= 20_000 && Boolean(value.trim()); }
function validVersion(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000; }
function validDigest(value: unknown): value is Digest { return typeof value === "string" && digest.test(value); }
function validId(value: unknown): value is Uuid { return typeof value === "string" && uuid.test(value); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function canonicalPayload(payload: GuestPendingActionPayload): string {
  switch (payload.kind) {
    case "new_research": return JSON.stringify([payload.kind, payload.text]);
    case "follow_up": return JSON.stringify([payload.kind, payload.text, payload.parentRunId]);
    case "clarification": return JSON.stringify([payload.kind, payload.text, payload.pendingInputId, payload.briefRevision, payload.field]);
  }
}

function readPayload(value: unknown): GuestPendingActionPayload {
  if (!record(value) || typeof value.kind !== "string" || !(value.kind in actionKeys) || !exactKeys(value, actionKeys[value.kind as GuestPendingActionKind])) invalid();
  const kind = value.kind as GuestPendingActionKind;
  if (!validText(value.text)) invalid();
  if (kind === "new_research") return { kind, text: value.text };
  if (kind === "follow_up") {
    if (!validId(value.parentRunId)) invalid();
    return { kind, text: value.text, parentRunId: value.parentRunId };
  }
  if (!validId(value.pendingInputId) || !validVersion(value.briefRevision) || typeof value.field !== "string" || !value.field || value.field.length > 80) invalid();
  return { kind, text: value.text, pendingInputId: value.pendingInputId, briefRevision: value.briefRevision, field: value.field };
}

function readAuthAttempt(value: unknown): GuestPendingAction["authAttempt"] {
  if (value === null) return null;
  if (!record(value) || !exactKeys(value, ["id", "provider"]) || !validId(value.id) || !["apple", "google", "email"].includes(String(value.provider))) invalid();
  return { id: value.id, provider: value.provider as GuestAuthProvider };
}
function readClaim(value: unknown): GuestPendingAction["claim"] {
  if (value === null) return null;
  if (!record(value) || !exactKeys(value, ["requestId", "accountId", "controlVersion", "principalEpoch", "viewEpoch"]) || !validId(value.requestId) || !validId(value.accountId) || !validVersion(value.controlVersion) || !validVersion(value.principalEpoch) || !validVersion(value.viewEpoch)) invalid();
  return {
    requestId: value.requestId, accountId: value.accountId, controlVersion: value.controlVersion,
    principalEpoch: value.principalEpoch, viewEpoch: value.viewEpoch,
  };
}

/** Every transition is decoded before persistence, so a new edge cannot write an unreadable journal. */
function persisted(candidate: GuestPendingAction): GuestPendingAction {
  return readGuestPendingAction(candidate);
}

/** Strictly decode persisted untrusted storage; corrupt journals never mint a replacement ID. */
export function readGuestPendingAction(value: unknown): GuestPendingAction {
  if (!record(value) || !exactKeys(value, [
    "version", "phase", "autoResume", "submissionId", "guestContextId", "conversationId", "conversationVersion", "draftRevision", "draftDigest", "payload", "payloadDigest", "consentPolicyVersion", "createdAt", "expiresAt", "authAttempt", "authenticatedAccountId", "claim", "dispatchReceiptId", "rejectionCode",
  ]) || value.version !== GUEST_PENDING_ACTION_VERSION || typeof value.phase !== "string" || !phases.has(value.phase as GuestPendingActionPhase) || typeof value.autoResume !== "boolean" ||
    !validId(value.submissionId) || !validId(value.guestContextId) || !validId(value.conversationId) || !validVersion(value.conversationVersion) || !validVersion(value.draftRevision) || !validDigest(value.draftDigest) ||
    !validDigest(value.payloadDigest) || typeof value.consentPolicyVersion !== "string" || !value.consentPolicyVersion || value.consentPolicyVersion.length > 120 || !validDate(value.createdAt) || !validDate(value.expiresAt) ||
    !(value.authenticatedAccountId === null || validId(value.authenticatedAccountId)) || !(value.dispatchReceiptId === null || validId(value.dispatchReceiptId)) ||
    !(value.rejectionCode === null || ["guest_expired", "guest_deleted", "authority_denied", "intent_stale"].includes(String(value.rejectionCode)))) invalid();
  const payload = readPayload(value.payload), authAttempt = readAuthAttempt(value.authAttempt), claim = readClaim(value.claim);
  const intent: GuestPendingAction = {
    version: GUEST_PENDING_ACTION_VERSION, phase: value.phase as GuestPendingActionPhase, autoResume: value.autoResume,
    submissionId: value.submissionId, guestContextId: value.guestContextId, conversationId: value.conversationId,
    conversationVersion: value.conversationVersion, draftRevision: value.draftRevision, draftDigest: value.draftDigest,
    payload, payloadDigest: value.payloadDigest, consentPolicyVersion: value.consentPolicyVersion,
    createdAt: value.createdAt, expiresAt: value.expiresAt, authAttempt, authenticatedAccountId: value.authenticatedAccountId,
    claim, dispatchReceiptId: value.dispatchReceiptId, rejectionCode: value.rejectionCode as GuestPendingAction["rejectionCode"],
  };
  if (intent.payloadDigest !== sha256Hex(canonicalPayload(payload)) || Date.parse(intent.expiresAt) <= Date.parse(intent.createdAt) || Date.parse(intent.expiresAt) - Date.parse(intent.createdAt) > GUEST_PENDING_ACTION_MAX_AGE_MS) invalid();
  if ((intent.phase === "authenticating") !== (intent.authAttempt !== null) ||
    (["authenticated", "claim_pending", "claimed", "resume_pending", "dispatched"].includes(intent.phase) && intent.authenticatedAccountId === null) ||
    (["claimed", "resume_pending", "dispatched"].includes(intent.phase) && intent.claim === null) ||
    (intent.claim !== null && (intent.authenticatedAccountId === null || intent.claim.accountId !== intent.authenticatedAccountId)) ||
    (intent.phase === "dispatched") !== (intent.dispatchReceiptId !== null) ||
    (intent.phase === "rejected") !== (intent.rejectionCode !== null) ||
    (["dispatched", "cancelled", "rejected", "expired"].includes(intent.phase) && intent.autoResume) ||
    (intent.phase === "expired" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "dispatched" && (intent.authAttempt !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "cancelled" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "rejected" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null)) ||
    (["pending_auth", "dismissed"].includes(intent.phase) && (intent.authenticatedAccountId !== null || intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "authenticating" && (intent.authenticatedAccountId !== null || intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "authenticated" && (intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "claim_pending" && (intent.claim === null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null))) invalid();
  return intent;
}

export function createGuestPendingAction(input: NewGuestPendingAction): GuestPendingAction {
  const candidate = {
    ...input, version: GUEST_PENDING_ACTION_VERSION, phase: "pending_auth" as const, autoResume: true,
    payloadDigest: sha256Hex(canonicalPayload(input.payload)), authAttempt: null, authenticatedAccountId: null,
    claim: null, dispatchReceiptId: null, rejectionCode: null,
  };
  return readGuestPendingAction(candidate);
}

export function pendingActionExpired(intent: GuestPendingAction, now: Date): boolean {
  return now.getTime() >= Date.parse(intent.expiresAt);
}
function current(intent: GuestPendingAction, allowed: GuestPendingActionPhase[], now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (pendingActionExpired(checked, now)) throw new Error("This saved sign-in action has expired.");
  if (!allowed.includes(checked.phase)) throw new Error("This saved sign-in action cannot continue from its current state.");
  return checked;
}

function isTerminal(intent: GuestPendingAction): boolean {
  return ["dispatched", "cancelled", "rejected", "expired"].includes(intent.phase);
}

/**
 * Expiry forbids another automatic action. It deliberately does not replace a
 * known terminal outcome: doing so would leave an expired record with a
 * dispatch receipt/rejection that the strict decoder must reject.
 */
export function expireGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (isTerminal(checked) || !pendingActionExpired(checked, now)) return checked;
  // A continuation in this phase may already have been admitted. Keep the
  // stable submission ID and phase so its idempotent resolution can be read,
  // but turn off every automatic send/retry path.
  if (checked.phase === "resume_pending") return persisted({ ...checked, autoResume: false });
  return persisted({ ...checked, phase: "expired", autoResume: false, authAttempt: null });
}

/**
 * `resume_pending` may have reached the server before a response was lost.
 * It is reconcile-only after expiry: callers must resolve its existing
 * submission ID, never issue a replacement continuation.
 */
export function guestPendingActionNeedsReconciliation(intent: GuestPendingAction, now: Date): boolean {
  const checked = readGuestPendingAction(intent);
  return checked.phase === "resume_pending" && pendingActionExpired(checked, now) && !checked.autoResume;
}

export function beginGuestAuth(intent: GuestPendingAction, attempt: { id: Uuid; provider: GuestAuthProvider }, now: Date): GuestPendingAction {
  const checked = current(intent, ["pending_auth"], now);
  if (!validId(attempt.id) || !["apple", "google", "email"].includes(attempt.provider)) throw new Error("Invalid sign-in attempt.");
  return persisted({ ...checked, phase: "authenticating", authAttempt: { ...attempt } });
}
/** Provider cancellation is not a failed claim and leaves the exact action available to retry. */
export function cancelGuestAuthAttempt(intent: GuestPendingAction, attemptId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticating"], now);
  if (checked.authAttempt?.id !== attemptId) throw new Error("A stale sign-in attempt cannot change this action.");
  return persisted({ ...checked, phase: "pending_auth", authAttempt: null });
}
export function completeGuestAuth(intent: GuestPendingAction, attemptId: Uuid, accountId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticating"], now);
  if (checked.authAttempt?.id !== attemptId || !validId(accountId)) throw new Error("A stale sign-in result cannot continue this action.");
  return persisted({ ...checked, phase: "authenticated", authAttempt: null, authenticatedAccountId: accountId });
}
/** Close/back always preserves payload. It only disables automatic continuation. */
export function dismissGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (isTerminal(checked)) return checked;
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  if (checked.phase === "pending_auth" || checked.phase === "authenticating") return persisted({ ...checked, phase: "dismissed", autoResume: false, authAttempt: null });
  return persisted({ ...checked, autoResume: false });
}

/**
 * Cancelling the handoff is terminal locally, but deliberately retains an
 * accepted account/claim binding for audit and stale-callback fencing. It
 * never clears a submitted receipt because submitted actions are terminal.
 */
export function cancelGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (isTerminal(checked)) return checked;
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  return persisted({ ...checked, phase: "cancelled", autoResume: false, authAttempt: null, dispatchReceiptId: null, rejectionCode: null });
}
/**
 * A fresh explicit Send may resume a dismissed handoff without changing its
 * submission or accepted claim identity. A pending claim keeps its original
 * request ID; no second claim or continuation ID is minted here.
 */
export function reopenGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = current(intent, ["dismissed", "authenticated", "claim_pending", "claimed", "resume_pending"], now);
  if (checked.autoResume) throw new Error("This saved sign-in action has not been dismissed.");
  if (checked.phase === "dismissed") return persisted({ ...checked, phase: "pending_auth", autoResume: true });
  return persisted({ ...checked, autoResume: true });
}
export function beginGuestClaim(intent: GuestPendingAction, requestId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticated"], now);
  if (!validId(requestId) || !checked.authenticatedAccountId) throw new Error("The signed-in account cannot claim this action.");
  return persisted({
    ...checked, phase: "claim_pending",
    claim: { requestId, accountId: checked.authenticatedAccountId, controlVersion: 0, principalEpoch: 0, viewEpoch: 0 },
  });
}
/** Retry uses the original claim identity; a new ID would make an ambiguous claim unsafe. */
export function retryGuestClaim(intent: GuestPendingAction, now: Date): GuestPendingAction {
  return current(intent, ["claim_pending"], now);
}
export function completeGuestClaim(intent: GuestPendingAction, result: {
  requestId: Uuid; accountId: Uuid; controlVersion: number; conversationId: Uuid; conversationVersion: number;
  principalEpoch: number; viewEpoch: number;
}, now: Date): GuestPendingAction {
  const checked = current(intent, ["claim_pending"], now);
  if (!checked.claim || result.requestId !== checked.claim.requestId || result.accountId !== checked.authenticatedAccountId || !validVersion(result.controlVersion) || !validVersion(result.principalEpoch) || !validVersion(result.viewEpoch) || result.conversationId !== checked.conversationId || result.conversationVersion !== checked.conversationVersion) throw new Error("The guest conversation claim did not match the saved action.");
  return persisted({
    ...checked, phase: "claimed",
    claim: { ...checked.claim, controlVersion: result.controlVersion, principalEpoch: result.principalEpoch, viewEpoch: result.viewEpoch },
  });
}
export function validateGuestActionResume(intent: GuestPendingAction, context: CurrentResumeContext): ResumeValidation {
  const checked = readGuestPendingAction(intent);
  if (pendingActionExpired(checked, context.now)) return { ok: false, code: "expired" };
  if (!(["claimed", "resume_pending"].includes(checked.phase))) return { ok: false, code: "phase" };
  if (!checked.autoResume) return { ok: false, code: "dismissed" };
  if (checked.authenticatedAccountId !== context.accountId) return { ok: false, code: "account" };
  if (!context.sessionActive) return { ok: false, code: "session" };
  if (!checked.claim || checked.claim.accountId !== context.accountId || checked.claim.controlVersion !== context.controlVersion) return { ok: false, code: "claim" };
  if (checked.claim.principalEpoch !== context.principalEpoch) return { ok: false, code: "principal" };
  if (checked.claim.viewEpoch !== context.viewEpoch || checked.guestContextId !== context.guestContextId || checked.conversationId !== context.conversationId || checked.conversationVersion !== context.conversationVersion) return { ok: false, code: "view" };
  if (checked.draftRevision !== context.draftRevision || checked.draftDigest !== context.draftDigest) return { ok: false, code: "draft" };
  if (checked.consentPolicyVersion !== context.consentPolicyVersion) return { ok: false, code: "consent" };
  if (!context.authorityAllowed) return { ok: false, code: "authority" };
  if (!context.budgetAllowed) return { ok: false, code: "budget" };
  return { ok: true };
}
/** Claim is completed before this state can be entered. Dispatch remains server-idempotent on submissionId. */
export function beginGuestActionResume(intent: GuestPendingAction, context: CurrentResumeContext): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  const validation = validateGuestActionResume(checked, context);
  if (!validation.ok) throw new Error(`Saved sign-in action cannot resume: ${validation.code}.`);
  return persisted({ ...checked, phase: "resume_pending" });
}
/** Terminal exactly-once client record; a late duplicate acknowledgment cannot overwrite it. */
export function markGuestActionDispatched(intent: GuestPendingAction, receiptId: Uuid, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (checked.phase !== "resume_pending") throw new Error("This saved sign-in action cannot continue from its current state.");
  if (!validId(receiptId)) throw new Error("Research continuation could not be confirmed.");
  // This records a response from the original submission. It does not issue a
  // new request, so it remains safe after expiry while reconciliation is on.
  void now;
  return persisted({ ...checked, phase: "dispatched", dispatchReceiptId: receiptId, autoResume: false });
}
export function rejectGuestPendingAction(intent: GuestPendingAction, code: NonNullable<GuestPendingAction["rejectionCode"]>, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (!(["guest_expired", "guest_deleted", "authority_denied", "intent_stale"] as const).includes(code)) throw new Error("Invalid saved sign-in action rejection.");
  if (["dispatched", "cancelled", "rejected"].includes(checked.phase)) throw new Error("This saved sign-in action is already terminal.");
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  return persisted({ ...checked, phase: "rejected", autoResume: false, authAttempt: null, rejectionCode: code });
}
