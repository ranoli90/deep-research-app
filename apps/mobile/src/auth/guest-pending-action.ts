import { sha256Hex } from "../sha256";

/**
 * The client-side half of the guest-to-member handoff journal. This is not an
 * authorization mechanism: the API owns admission, claim, capability, budget,
 * and idempotency. Keeping the envelope strict prevents a late OAuth callback
 * from silently changing or submitting a different local action.
 */
export const GUEST_PENDING_ACTION_VERSION = "guest-pending-action.v3" as const;
export const GUEST_PENDING_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Uuid = string;
type Digest = string;
export type GuestPendingActionPhase =
  | "pending_auth"
  | "authenticating"
  | "authenticated"
  | "claim_pending"
  /** The original claim may be reconciled, but can never be retried or replaced. */
  | "claim_reconcile"
  | "claimed"
  /** Exact edited member clarification is saved before idempotent registration. */
  | "member_register_pending"
  | "member_claimed"
  /** A claimed action is held because its required trial/funding prerequisite is missing. Never a dismissal. */
  | "funding_pending"
  /** A definitive server funding denial (402/403). Known, not unknown; retained for an explicit re-engagement. */
  | "funding_denied"
  /** A funding grant outcome is unknown. Resolve by replaying the same idempotent grant; never auto-resent. */
  | "funding_reconcile"
  | "resume_pending"
  /** The original continuation may be reconciled, but can never be resent. */
  | "resume_reconcile"
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
  /** The accepted member child bound to the dispatch receipt; non-null only while phase is "dispatched". */
  memberRunId: Uuid | null;
  memberConversationId: Uuid | null;
  rejectionCode: "guest_expired" | "guest_deleted" | "authority_denied" | "intent_stale" | null;
};

export type NewGuestPendingAction = Omit<GuestPendingAction,
  "version" | "phase" | "autoResume" | "payloadDigest" | "authAttempt" | "authenticatedAccountId" | "claim" | "dispatchReceiptId" | "memberRunId" | "memberConversationId" | "rejectionCode">;

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

/**
 * API outcomes are correlated to the immutable local submission before they
 * can change a durable journal. Reconciliation must never terminalize a newer
 * handoff from a delayed callback for another request.
 */
export type GuestClaimAcceptedOutcome = {
  type: "claim_accepted";
  submissionId: Uuid;
  requestId: Uuid;
  accountId: Uuid;
  controlVersion: number;
  conversationId: Uuid;
  conversationVersion: number;
  principalEpoch: number;
  viewEpoch: number;
};
export type GuestContinuationDispatchedOutcome = {
  type: "continuation_dispatched";
  submissionId: Uuid;
  claimRequestId: Uuid;
  /** The claimed member and conversation scope echoed by the server. */
  accountId: Uuid;
  conversationId: Uuid;
  conversationVersion: number;
  receiptId: Uuid;
  /** The exact accepted member child. It is the only run a restart may restore for this receipt. */
  runId: Uuid;
  memberConversationId: Uuid;
};
export type GuestPendingActionRejectionOutcome =
  | {
    type: "claim_rejected";
    submissionId: Uuid;
    requestId: Uuid;
    /** Rejections must be scoped to the same authenticated member/conversation. */
    accountId: Uuid;
    conversationId: Uuid;
    conversationVersion: number;
    rejectionCode: NonNullable<GuestPendingAction["rejectionCode"]>;
  }
  | {
    type: "continuation_rejected";
    submissionId: Uuid;
    claimRequestId: Uuid;
    /** Rejections must be scoped to the same claimed member/conversation. */
    accountId: Uuid;
    conversationId: Uuid;
    conversationVersion: number;
    rejectionCode: NonNullable<GuestPendingAction["rejectionCode"]>;
  };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const phases = new Set<GuestPendingActionPhase>([
  "pending_auth", "authenticating", "authenticated", "claim_pending", "claim_reconcile", "claimed", "member_register_pending", "member_claimed", "funding_pending", "funding_denied", "funding_reconcile", "resume_pending", "resume_reconcile", "dispatched", "dismissed", "cancelled", "rejected", "expired",
]);
/** Held funding states retain the exact claim but never auto-continue. */
const fundingPhases: readonly GuestPendingActionPhase[] = ["funding_pending", "funding_denied", "funding_reconcile"];
export function isFundingPhase(phase: GuestPendingActionPhase): boolean {
  return (fundingPhases as readonly string[]).includes(phase);
}
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
    "version", "phase", "autoResume", "submissionId", "guestContextId", "conversationId", "conversationVersion", "draftRevision", "draftDigest", "payload", "payloadDigest", "consentPolicyVersion", "createdAt", "expiresAt", "authAttempt", "authenticatedAccountId", "claim", "dispatchReceiptId", "memberRunId", "memberConversationId", "rejectionCode",
  ]) || value.version !== GUEST_PENDING_ACTION_VERSION || typeof value.phase !== "string" || !phases.has(value.phase as GuestPendingActionPhase) || typeof value.autoResume !== "boolean" ||
    !validId(value.submissionId) || !validId(value.guestContextId) || !validId(value.conversationId) || !validVersion(value.conversationVersion) || !validVersion(value.draftRevision) || !validDigest(value.draftDigest) ||
    !validDigest(value.payloadDigest) || typeof value.consentPolicyVersion !== "string" || !value.consentPolicyVersion || value.consentPolicyVersion.length > 120 || !validDate(value.createdAt) || !validDate(value.expiresAt) ||
    !(value.authenticatedAccountId === null || validId(value.authenticatedAccountId)) || !(value.dispatchReceiptId === null || validId(value.dispatchReceiptId)) ||
    !(value.memberRunId === null || validId(value.memberRunId)) || !(value.memberConversationId === null || validId(value.memberConversationId)) ||
    !(value.rejectionCode === null || ["guest_expired", "guest_deleted", "authority_denied", "intent_stale"].includes(String(value.rejectionCode)))) invalid();
  const payload = readPayload(value.payload), authAttempt = readAuthAttempt(value.authAttempt), claim = readClaim(value.claim);
  const intent: GuestPendingAction = {
    version: GUEST_PENDING_ACTION_VERSION, phase: value.phase as GuestPendingActionPhase, autoResume: value.autoResume,
    submissionId: value.submissionId, guestContextId: value.guestContextId, conversationId: value.conversationId,
    conversationVersion: value.conversationVersion, draftRevision: value.draftRevision, draftDigest: value.draftDigest,
    payload, payloadDigest: value.payloadDigest, consentPolicyVersion: value.consentPolicyVersion,
    createdAt: value.createdAt, expiresAt: value.expiresAt, authAttempt, authenticatedAccountId: value.authenticatedAccountId,
    claim, dispatchReceiptId: value.dispatchReceiptId, memberRunId: value.memberRunId, memberConversationId: value.memberConversationId,
    rejectionCode: value.rejectionCode as GuestPendingAction["rejectionCode"],
  };
  if (intent.payloadDigest !== sha256Hex(canonicalPayload(payload)) || Date.parse(intent.expiresAt) <= Date.parse(intent.createdAt) || Date.parse(intent.expiresAt) - Date.parse(intent.createdAt) > GUEST_PENDING_ACTION_MAX_AGE_MS) invalid();
  if ((intent.phase === "authenticating" && intent.authAttempt === null) ||
    (intent.authAttempt !== null && !["authenticating", "authenticated", "claim_pending", "claim_reconcile"].includes(intent.phase)) ||
    (["authenticated", "claim_pending", "claim_reconcile", "claimed", "member_register_pending", "member_claimed", ...fundingPhases, "resume_pending", "resume_reconcile", "dispatched"].includes(intent.phase) && intent.authenticatedAccountId === null) ||
    (["claim_reconcile", "claimed", "member_register_pending", "member_claimed", ...fundingPhases, "resume_pending", "resume_reconcile", "dispatched"].includes(intent.phase) && intent.claim === null) ||
    (fundingPhases.includes(intent.phase) && (intent.authAttempt !== null || intent.autoResume || intent.dispatchReceiptId !== null || intent.memberRunId !== null || intent.memberConversationId !== null || intent.rejectionCode !== null)) ||
    (intent.claim !== null && (intent.authenticatedAccountId === null || intent.claim.accountId !== intent.authenticatedAccountId)) ||
    (intent.phase === "dispatched") !== (intent.dispatchReceiptId !== null) ||
    (intent.phase === "dispatched") !== (intent.memberRunId !== null) ||
    (intent.phase === "dispatched") !== (intent.memberConversationId !== null) ||
    (intent.phase === "rejected") !== (intent.rejectionCode !== null) ||
    (["dispatched", "cancelled", "rejected", "expired"].includes(intent.phase) && intent.autoResume) ||
    (intent.phase === "expired" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "dispatched" && (intent.authAttempt !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "cancelled" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "rejected" && (intent.authAttempt !== null || intent.dispatchReceiptId !== null)) ||
    (["pending_auth", "dismissed"].includes(intent.phase) && (intent.authenticatedAccountId !== null || intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "authenticating" && (intent.authenticatedAccountId !== null || intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "authenticated" && (intent.claim !== null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "claim_pending" && (intent.claim === null || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "claim_reconcile" && (intent.claim === null || intent.autoResume || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (["member_register_pending", "member_claimed"].includes(intent.phase) && (intent.payload.kind !== "clarification" || intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "resume_pending" && (intent.dispatchReceiptId !== null || intent.rejectionCode !== null)) ||
    (intent.phase === "resume_reconcile" && (intent.claim === null || intent.autoResume || intent.dispatchReceiptId !== null || intent.rejectionCode !== null))) invalid();
  return intent;
}

export function createGuestPendingAction(input: NewGuestPendingAction): GuestPendingAction {
  const candidate = {
    ...input, version: GUEST_PENDING_ACTION_VERSION, phase: "pending_auth" as const, autoResume: true,
    payloadDigest: sha256Hex(canonicalPayload(input.payload)), authAttempt: null, authenticatedAccountId: null,
    claim: null, dispatchReceiptId: null, memberRunId: null, memberConversationId: null, rejectionCode: null,
  };
  return readGuestPendingAction(candidate);
}

/** A claimed clarification may be edited only after the old server action is abandoned. */
export function prepareMemberClarificationReplacement(old: GuestPendingAction, payload: Extract<GuestPendingActionPayload, { kind: "clarification" }>, submissionId: Uuid, draftRevision: number, now: Date, sessionEpochs: { principalEpoch: number; viewEpoch: number }): GuestPendingAction {
  const previous = readGuestPendingAction(old);
  if (previous.phase !== "cancelled" || previous.payload.kind !== "clarification" || !previous.claim || !previous.authenticatedAccountId ||
    previous.payload.pendingInputId !== payload.pendingInputId || previous.payload.briefRevision !== payload.briefRevision || previous.payload.field !== payload.field ||
    previous.payload.text === payload.text || !validId(submissionId) || !validVersion(draftRevision) ||
    !validVersion(sessionEpochs.principalEpoch) || !validVersion(sessionEpochs.viewEpoch)) throw new Error("The edited clarification is not bound to an abandoned answer.");
  const createdAt = now.toISOString();
  const expiresAt = new Date(Math.min(Date.parse(previous.expiresAt), now.getTime() + GUEST_PENDING_ACTION_MAX_AGE_MS)).toISOString();
  if (Date.parse(expiresAt) <= now.getTime()) throw new Error("The saved clarification expired before replacement.");
  const base = createGuestPendingAction({ submissionId, guestContextId: previous.guestContextId, conversationId: previous.conversationId,
    conversationVersion: previous.conversationVersion, draftRevision, draftDigest: sha256Hex(payload.text), payload,
    consentPolicyVersion: previous.consentPolicyVersion, createdAt, expiresAt });
  return persisted({ ...base, phase: "member_register_pending", authenticatedAccountId: previous.authenticatedAccountId,
    claim: { ...previous.claim, principalEpoch: sessionEpochs.principalEpoch, viewEpoch: sessionEpochs.viewEpoch } });
}

export function confirmMemberClarificationRegistration(action: GuestPendingAction, receipt: {
  type: "member_action_registered"; submissionId: string; claimRequestId: string; controlVersion: number; payloadDigest: string; expiresAt: string;
}, now: Date): GuestPendingAction {
  const saved = current(action, ["member_register_pending"], now);
  if (receipt.type !== "member_action_registered" || receipt.submissionId !== saved.submissionId || receipt.claimRequestId !== saved.claim?.requestId ||
    receipt.payloadDigest !== saved.payloadDigest || !validVersion(receipt.controlVersion) || !validDate(receipt.expiresAt) || Date.parse(receipt.expiresAt) <= now.getTime()) throw new Error("Edited clarification registration did not match its saved identity.");
  return persisted({ ...saved, phase: "member_claimed", expiresAt: new Date(Math.min(Date.parse(saved.expiresAt), Date.parse(receipt.expiresAt))).toISOString(),
    claim: { ...saved.claim!, controlVersion: receipt.controlVersion } });
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
 * A continuation acknowledgement must bind every stable identity captured by
 * the journal. Submission and claim request IDs alone are not sufficient: a
 * delayed response from another member or conversation must not terminalize
 * this handoff, particularly while resume reconciliation is the only action
 * still permitted.
 */
function continuationOutcomeMatches(
  intent: GuestPendingAction,
  outcome: GuestContinuationDispatchedOutcome | Extract<GuestPendingActionRejectionOutcome, { type: "continuation_rejected" }>,
): boolean {
  return intent.claim !== null && intent.authenticatedAccountId !== null &&
    outcome.submissionId === intent.submissionId &&
    outcome.claimRequestId === intent.claim.requestId &&
    validId(outcome.accountId) && outcome.accountId === intent.authenticatedAccountId && outcome.accountId === intent.claim.accountId &&
    validId(outcome.conversationId) && outcome.conversationId === intent.conversationId &&
    validVersion(outcome.conversationVersion) && outcome.conversationVersion === intent.conversationVersion;
}

/**
 * Claim rejection is a terminal outcome too, so it needs the same member and
 * conversation correlation as a claim success. Without this fence, a delayed
 * rejection for another account or conversation could terminalize the only
 * reconciliation record for this handoff.
 */
function claimRejectionOutcomeMatches(
  intent: GuestPendingAction,
  outcome: Extract<GuestPendingActionRejectionOutcome, { type: "claim_rejected" }>,
): boolean {
  return intent.claim !== null && intent.authenticatedAccountId !== null &&
    outcome.submissionId === intent.submissionId &&
    outcome.requestId === intent.claim.requestId &&
    validId(outcome.accountId) && outcome.accountId === intent.authenticatedAccountId && outcome.accountId === intent.claim.accountId &&
    validId(outcome.conversationId) && outcome.conversationId === intent.conversationId &&
    validVersion(outcome.conversationVersion) && outcome.conversationVersion === intent.conversationVersion;
}

/**
 * Expiry forbids another automatic action. It deliberately does not replace a
 * known terminal outcome: doing so would leave an expired record with a
 * dispatch receipt/rejection that the strict decoder must reject.
 */
export function expireGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  // Reconcile-only is already the post-expiry state. Re-expiring it must not
  // erase the sole IDs that can correlate a delayed server outcome.
  if (isTerminal(checked) || ["claim_reconcile", "resume_reconcile", "funding_reconcile"].includes(checked.phase) || !pendingActionExpired(checked, now)) return checked;
  // A claim or continuation may already have reached the API. Preserve only
  // its existing IDs/bindings in a reconcile-only state; no retry can mint a
  // replacement request or submission identity.
  if (checked.phase === "claim_pending") return persisted({ ...checked, phase: "claim_reconcile", autoResume: false });
  if (checked.phase === "resume_pending") return persisted({ ...checked, phase: "resume_reconcile", autoResume: false });
  return persisted({ ...checked, phase: "expired", autoResume: false, authAttempt: null });
}

/**
 * A claim, continuation, or funding grant may have reached the server before
 * its reply was lost. A reconcile-only record can resolve that original ID,
 * never send a replacement action.
 */
export function guestPendingActionNeedsReconciliation(intent: GuestPendingAction, now: Date): boolean {
  const checked = readGuestPendingAction(intent);
  return ["claim_reconcile", "resume_reconcile", "funding_reconcile"].includes(checked.phase) && pendingActionExpired(checked, now) && !checked.autoResume;
}

export function beginGuestAuth(intent: GuestPendingAction, attempt: { id: Uuid; provider: GuestAuthProvider }, now: Date): GuestPendingAction {
  const checked = current(intent, ["pending_auth"], now);
  if (!checked.autoResume) throw new Error("A dismissed sign-in action cannot start authentication.");
  if (!validId(attempt.id) || !["apple", "google", "email"].includes(attempt.provider)) throw new Error("Invalid sign-in attempt.");
  return persisted({ ...checked, phase: "authenticating", authAttempt: { ...attempt } });
}
/** Keep the exact attempt ID until the server confirms its terminal fence. */
export function holdGuestAuthAttempt(intent: GuestPendingAction, attemptId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticating"], now);
  if (checked.authAttempt?.id !== attemptId) throw new Error("A stale sign-in attempt cannot be held.");
  return persisted({ ...checked, autoResume: false });
}
/** Provider cancellation is not a failed claim and leaves the exact action available to retry. */
export function cancelGuestAuthAttempt(intent: GuestPendingAction, attemptId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticating"], now);
  if (checked.authAttempt?.id !== attemptId) throw new Error("A stale sign-in attempt cannot change this action.");
  return persisted({ ...checked, phase: "pending_auth", autoResume: true, authAttempt: null });
}
export function completeGuestAuth(intent: GuestPendingAction, attemptId: Uuid, accountId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticating"], now);
  if (!checked.autoResume || checked.authAttempt?.id !== attemptId || !validId(accountId)) throw new Error("A stale sign-in result cannot continue this action.");
  return persisted({ ...checked, phase: "authenticated", authenticatedAccountId: accountId });
}
/** Close/back always preserves payload. It only disables automatic continuation. */
export function dismissGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (isTerminal(checked)) return checked;
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  if (checked.phase === "pending_auth" || checked.phase === "authenticating") return persisted({ ...checked, phase: "dismissed", autoResume: false, authAttempt: null });
  // A deliberate dismissal of a held funding state returns to the exact claimed
  // phase with autoResume off, so it is never confused with "missing
  // prerequisite" (funding_pending) or "unknown outcome" (funding_reconcile).
  if (checked.phase === "funding_pending" || checked.phase === "funding_denied")
    return persisted({ ...checked, phase: checked.payload.kind === "clarification" ? "member_claimed" : "claimed", autoResume: false });
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
  return persisted({ ...checked, phase: "cancelled", autoResume: false, authAttempt: null, dispatchReceiptId: null, memberRunId: null, memberConversationId: null, rejectionCode: null });
}
/**
 * A fresh explicit Send may resume a dismissed handoff without changing its
 * submission or accepted claim identity. A pending claim keeps its original
 * request ID; no second claim or continuation ID is minted here. A held
 * funding state reopens to the exact claimed phase only after the caller has
 * confirmed an eligible grant; the claim identity is untouched.
 */
export function reopenGuestPendingAction(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = current(intent, ["dismissed", "authenticated", "claim_pending", "claimed", "member_register_pending", "member_claimed", "funding_pending", "funding_denied", "funding_reconcile", "resume_pending"], now);
  if (checked.autoResume) throw new Error("This saved sign-in action has not been dismissed.");
  if (checked.phase === "dismissed") return persisted({ ...checked, phase: "pending_auth", autoResume: true });
  if (isFundingPhase(checked.phase))
    return persisted({ ...checked, phase: checked.payload.kind === "clarification" ? "member_claimed" : "claimed", autoResume: true });
  return persisted({ ...checked, autoResume: true });
}

/**
 * Missing prerequisite: the claimed action is retained exactly, but automatic
 * continuation is off. This is NOT a dismissal and NOT an unknown outcome; an
 * explicit consent plus an eligible server grant can reopen it and run the
 * single continuation. No identity is minted or cleared here.
 */
export function requireGuestActionFunding(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  if (!(["claimed", "member_claimed", "claim_pending", "resume_pending"].includes(checked.phase)) || !checked.claim || checked.authenticatedAccountId === null)
    throw new Error("Only a claimed action can be held for funding.");
  return persisted({ ...checked, phase: "funding_pending", autoResume: false, authAttempt: null });
}

/**
 * Definitive server funding denial (402/403). This is known, not unknown, so
 * the exact claim is retained for an explicit re-engagement after funding
 * rather than being reconciled as an uncertain outcome or dismissed.
 */
export function denyGuestActionFunding(intent: GuestPendingAction, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (pendingActionExpired(checked, now)) return expireGuestPendingAction(checked, now);
  if (!(["claimed", "member_claimed", "resume_pending", "funding_pending"].includes(checked.phase)) || !checked.claim || checked.authenticatedAccountId === null)
    throw new Error("Only a claimed action can record a funding denial.");
  return persisted({ ...checked, phase: "funding_denied", autoResume: false, authAttempt: null });
}

/**
 * Unknown funding grant outcome. The grant may have been accepted server-side,
 * so the journal is held reconcile-only; the same idempotent grant identity is
 * replayed to resolve it, and no replacement action is ever sent.
 */
export function holdGuestFundingForReconciliation(intent: GuestPendingAction): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (!(["claimed", "member_claimed", "funding_pending", "funding_denied"].includes(checked.phase)) || !checked.claim)
    throw new Error("Only a claimed or held funding action can be reconciled.");
  return persisted({ ...checked, phase: "funding_reconcile", autoResume: false });
}
export function beginGuestClaim(intent: GuestPendingAction, requestId: Uuid, now: Date): GuestPendingAction {
  const checked = current(intent, ["authenticated"], now);
  if (!validId(requestId) || !checked.authenticatedAccountId || !checked.authAttempt) throw new Error("The signed-in account cannot claim this action.");
  return persisted({
    ...checked, phase: "claim_pending",
    claim: { requestId, accountId: checked.authenticatedAccountId, controlVersion: 0, principalEpoch: 0, viewEpoch: 0 },
  });
}
/** Retry uses the original claim identity; a new ID would make an ambiguous claim unsafe. */
export function retryGuestClaim(intent: GuestPendingAction, now: Date): GuestPendingAction {
  return current(intent, ["claim_pending"], now);
}
/** Network ambiguity is resolve-only even before the action's deadline. */
export function holdGuestClaimForReconciliation(intent: GuestPendingAction): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (checked.phase !== "claim_pending") throw new Error("Only an in-flight claim can be held for resolution.");
  return persisted({ ...checked, phase: "claim_reconcile", autoResume: false });
}
export function completeGuestClaim(intent: GuestPendingAction, result: GuestClaimAcceptedOutcome, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  // claim_reconcile accepts only the delayed outcome for the original claim;
  // it intentionally bypasses the deadline check because it sends nothing.
  if (!(checked.phase === "claim_pending" || checked.phase === "claim_reconcile") ||
    (checked.phase === "claim_pending" && pendingActionExpired(checked, now))) {
    throw new Error("This saved sign-in action cannot continue from its current state.");
  }
  if (result.type !== "claim_accepted" || !checked.claim || result.submissionId !== checked.submissionId || result.requestId !== checked.claim.requestId || result.accountId !== checked.authenticatedAccountId || !validVersion(result.controlVersion) || !validVersion(result.principalEpoch) || !validVersion(result.viewEpoch) || result.conversationId !== checked.conversationId || result.conversationVersion !== checked.conversationVersion) throw new Error("The guest conversation claim did not match the saved action.");
  return persisted({
    ...checked, phase: "claimed", authAttempt: null,
    claim: { ...checked.claim, controlVersion: result.controlVersion, principalEpoch: result.principalEpoch, viewEpoch: result.viewEpoch },
  });
}
export function validateGuestActionResume(intent: GuestPendingAction, context: CurrentResumeContext): ResumeValidation {
  const checked = readGuestPendingAction(intent);
  if (pendingActionExpired(checked, context.now)) return { ok: false, code: "expired" };
  if (!(["claimed", "member_claimed", "resume_pending"].includes(checked.phase))) return { ok: false, code: "phase" };
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
/** Unknown continuation outcomes may only be resolved by the original IDs. */
export function holdGuestResumeForReconciliation(intent: GuestPendingAction): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (checked.phase !== "resume_pending") throw new Error("Only an in-flight continuation can be held for resolution.");
  return persisted({ ...checked, phase: "resume_reconcile", autoResume: false });
}
/**
 * A definitive 403 consent_required denial means the server did not dispatch:
 * member consent was absent, revoked, or outdated. The exact claim is retained
 * (never cleared, never reconciled as unknown) so one continuation can run
 * after explicit member consent. Guards are unchanged: resume still requires
 * the same validation before any new request.
 */
export function holdGuestResumeForConsent(intent: GuestPendingAction): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (checked.phase !== "resume_pending" || !checked.autoResume) throw new Error("Only an in-flight continuation awaiting consent can be held for consent.");
  return persisted({ ...checked, phase: checked.payload.kind === "clarification" ? "member_claimed" : "claimed" });
}
/**
 * Records the API acknowledgement for the stable client submission ID. The
 * server must enforce idempotency; this client journal does not claim external
 * exactly-once delivery. A late duplicate acknowledgement cannot overwrite it.
 */
export function markGuestActionDispatched(intent: GuestPendingAction, outcome: GuestContinuationDispatchedOutcome, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (!(checked.phase === "resume_pending" || checked.phase === "resume_reconcile")) throw new Error("This saved sign-in action cannot continue from its current state.");
  if (outcome.type !== "continuation_dispatched" || !continuationOutcomeMatches(checked, outcome) || !validId(outcome.receiptId) ||
    !validId(outcome.runId) || !validId(outcome.memberConversationId)) throw new Error("Research continuation could not be confirmed.");
  // This records a response from the original submission. It does not issue a
  // new request, so it remains safe after expiry while reconciliation is on.
  // The child run/conversation identity is committed with the receipt so a
  // restart can verify the exact accepted child instead of discarding it.
  void now;
  return persisted({ ...checked, phase: "dispatched", dispatchReceiptId: outcome.receiptId, memberRunId: outcome.runId, memberConversationId: outcome.memberConversationId, autoResume: false });
}
export function rejectGuestPendingAction(intent: GuestPendingAction, outcome: GuestPendingActionRejectionOutcome, now: Date): GuestPendingAction {
  const checked = readGuestPendingAction(intent);
  if (!(["guest_expired", "guest_deleted", "authority_denied", "intent_stale"] as const).includes(outcome.rejectionCode)) throw new Error("Invalid saved sign-in action rejection.");
  if (["dispatched", "cancelled", "rejected"].includes(checked.phase)) throw new Error("This saved sign-in action is already terminal.");
  // A delayed server rejection may be durably reconciled after expiry, but
  // only when the saved claim/continuation was already in flight.
  const reconciling = pendingActionExpired(checked, now)
    ? expireGuestPendingAction(checked, now)
    : checked;
  if (reconciling.phase === "expired") return reconciling;
  const claimMatches = outcome.type === "claim_rejected"
    ? claimRejectionOutcomeMatches(reconciling, outcome)
    : continuationOutcomeMatches(reconciling, outcome);
  const expectedPhase = outcome.type === "claim_rejected"
    ? reconciling.phase === "claim_pending" || reconciling.phase === "claim_reconcile"
    : reconciling.phase === "resume_pending" || reconciling.phase === "resume_reconcile";
  if (!claimMatches || !expectedPhase) throw new Error("The saved sign-in action rejection did not match the original request.");
  return persisted({ ...reconciling, phase: "rejected", autoResume: false, authAttempt: null, rejectionCode: outcome.rejectionCode });
}
