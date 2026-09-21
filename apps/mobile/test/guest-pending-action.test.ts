import { describe, expect, it } from "vitest";
import {
  beginGuestActionResume, beginGuestAuth, beginGuestClaim, cancelGuestAuthAttempt, cancelGuestPendingAction,
  completeGuestAuth, completeGuestClaim, createGuestPendingAction, dismissGuestPendingAction, expireGuestPendingAction,
  guestPendingActionNeedsReconciliation, markGuestActionDispatched, readGuestPendingAction, rejectGuestPendingAction,
  reopenGuestPendingAction, retryGuestClaim, validateGuestActionResume, holdGuestAuthAttempt,
  prepareMemberClarificationReplacement, confirmMemberClarificationRegistration,
  type GuestClaimAcceptedOutcome, type GuestContinuationDispatchedOutcome, type GuestPendingActionRejectionOutcome,
} from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const created = new Date("2026-09-20T12:00:00.000Z");
const expires = new Date("2026-09-21T12:00:00.000Z");
const draft = "Canada, under $2,000";
function pending(kind: "follow_up" | "clarification" = "follow_up") {
  return createGuestPendingAction({
    submissionId: id(1), guestContextId: id(2), conversationId: id(3), conversationVersion: 4, draftRevision: 7,
    draftDigest: sha256Hex(draft), payload: kind === "follow_up"
      ? { kind, text: draft, parentRunId: id(4) }
      : { kind, text: draft, pendingInputId: id(5), briefRevision: 9, field: "geography" },
    consentPolicyVersion: "consent.v1", createdAt: created.toISOString(), expiresAt: expires.toISOString(),
  });
}
function context() {
  return {
    now: new Date("2026-09-20T12:05:00.000Z"), accountId: id(7), sessionActive: true,
    guestContextId: id(2), conversationId: id(3), conversationVersion: 4, controlVersion: 12,
    principalEpoch: 3, viewEpoch: 8, credentialGeneration: 17,
    draftRevision: 7, draftDigest: sha256Hex(draft), consentPolicyVersion: "consent.v1", authorityAllowed: true, budgetAllowed: true,
  };
}
function claimAccepted(overrides: Partial<GuestClaimAcceptedOutcome> = {}): GuestClaimAcceptedOutcome {
  return {
    type: "claim_accepted", submissionId: id(1), requestId: id(8), accountId: id(7), controlVersion: 12,
    conversationId: id(3), conversationVersion: 4, principalEpoch: 3, viewEpoch: 8, ...overrides,
  };
}
function continuationDispatched(overrides: Partial<GuestContinuationDispatchedOutcome> = {}): GuestContinuationDispatchedOutcome {
  return {
    type: "continuation_dispatched", submissionId: id(1), claimRequestId: id(8), accountId: id(7),
    conversationId: id(3), conversationVersion: 4, receiptId: id(9), ...overrides,
  };
}
function continuationRejected(overrides: Partial<Extract<GuestPendingActionRejectionOutcome, { type: "continuation_rejected" }>> = {}): GuestPendingActionRejectionOutcome {
  return {
    type: "continuation_rejected", submissionId: id(1), claimRequestId: id(8), accountId: id(7),
    conversationId: id(3), conversationVersion: 4, rejectionCode: "authority_denied", ...overrides,
  };
}
function claimRejected(overrides: Partial<Extract<GuestPendingActionRejectionOutcome, { type: "claim_rejected" }>> = {}): GuestPendingActionRejectionOutcome {
  return {
    type: "claim_rejected", submissionId: id(1), requestId: id(8), accountId: id(7),
    conversationId: id(3), conversationVersion: 4, rejectionCode: "authority_denied", ...overrides,
  };
}
function claimed() {
  const auth = completeGuestAuth(beginGuestAuth(pending(), { id: id(6), provider: "apple" }, context().now), id(6), id(7), context().now);
  return completeGuestClaim(beginGuestClaim(auth, id(8), context().now), claimAccepted(), context().now);
}
function expectRoundTrip(action: unknown) {
  expect(readGuestPendingAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
}

describe("guest pending action", () => {
  it("CLAIM-14 accepts only an abandoned claimed clarification with exact pending identity for member replacement", () => {
    const now = context().now;
    const first = pending("clarification");
    const auth = completeGuestAuth(beginGuestAuth(first, { id: id(6), provider: "email" }, now), id(6), id(7), now);
    const old = cancelGuestPendingAction(completeGuestClaim(beginGuestClaim(auth, id(8), now), claimAccepted(), now), now);
    const payload = { kind: "clarification" as const, text: "Ontario", pendingInputId: id(5), briefRevision: 9, field: "geography" };
    const fresh = prepareMemberClarificationReplacement(old, payload, id(10), 8, now, { principalEpoch: 11, viewEpoch: 17 });
    expect(fresh).toMatchObject({ phase: "member_register_pending", submissionId: id(10), payload, claim: { requestId: id(8), principalEpoch: 11, viewEpoch: 17 } });
    expectRoundTrip(fresh);
    const receipt = { type: "member_action_registered" as const, submissionId: id(10), claimRequestId: id(8), controlVersion: 12,
      payloadDigest: fresh.payloadDigest, expiresAt: expires.toISOString() };
    const registered = confirmMemberClarificationRegistration(fresh, receipt, now);
    expect(registered.phase).toBe("member_claimed");
    expectRoundTrip(registered);
    const resume = { ...context(), principalEpoch: 11, viewEpoch: 17, draftRevision: 8, draftDigest: sha256Hex("Ontario") };
    expect(validateGuestActionResume(registered, resume)).toEqual({ ok: true });
    expect(() => prepareMemberClarificationReplacement(first, payload, id(10), 8, now, { principalEpoch: 11, viewEpoch: 17 })).toThrow("abandoned");
    expect(() => prepareMemberClarificationReplacement(old, { ...payload, pendingInputId: id(99) }, id(10), 8, now, { principalEpoch: 11, viewEpoch: 17 })).toThrow("abandoned");
    expect(() => confirmMemberClarificationRegistration(fresh, { ...receipt, payloadDigest: "f".repeat(64) }, now)).toThrow("registration");
    expect(() => markGuestActionDispatched(old, continuationDispatched({ submissionId: old.submissionId }), now)).toThrow("current state");
  });
  it("GUEST-02/GUEST-04 captures an exact clarification before auth without admitting it", () => {
    const action = pending("clarification");
    expect(action.phase).toBe("pending_auth");
    expect(action.payload).toEqual({ kind: "clarification", text: draft, pendingInputId: id(5), briefRevision: 9, field: "geography" });
    expect(action.payloadDigest).toHaveLength(64);
    expect(action.dispatchReceiptId).toBeNull();
  });

  it("AUTH-14 rejects corrupted, unknown-version, extra-field, and payload-digest-mismatched journals fail closed", () => {
    const valid = pending();
    for (const changed of [
      { ...valid, version: "guest-pending-action.v1" },
      { ...valid, extra: true },
      { ...valid, payloadDigest: "a".repeat(64) },
      { ...valid, phase: "unknown" },
      { ...valid, phase: "expired", autoResume: false, dispatchReceiptId: id(9) },
      { ...valid, phase: "dispatched", autoResume: false, dispatchReceiptId: id(9), authenticatedAccountId: null, claim: null },
      { ...valid, phase: "rejected", autoResume: false, rejectionCode: "authority_denied", authAttempt: { id: id(6), provider: "apple" } },
    ]) expect(() => readGuestPendingAction(changed)).toThrow("Saved sign-in action is invalid");
  });

  it("PROVIDER-02 preserves the exact action on cancellation and ignores a late callback", () => {
    const opening = beginGuestAuth(pending(), { id: id(6), provider: "google" }, context().now);
    const returned = cancelGuestAuthAttempt(opening, id(6), context().now);
    expect(returned.phase).toBe("pending_auth");
    expect(returned.payload).toEqual(opening.payload);
    expect(() => completeGuestAuth(returned, id(6), id(7), context().now)).toThrow("current state");
  });
  it("CLAIM-01 holds an uncertain server attempt with the same ID; stale callback and replacement begin cannot claim", () => {
    const opening = beginGuestAuth(pending(), { id: id(6), provider: "email" }, context().now);
    const held = holdGuestAuthAttempt(opening, id(6), context().now);
    expectRoundTrip(held);
    expect(held).toMatchObject({ phase: "authenticating", autoResume: false, authAttempt: { id: id(6) }, submissionId: id(1) });
    expect(() => completeGuestAuth(held, id(6), id(7), context().now)).toThrow("stale sign-in");
    expect(() => beginGuestAuth(held, { id: id(10), provider: "google" }, context().now)).toThrow("current state");
    const ended = dismissGuestPendingAction(held, context().now);
    expect(reopenGuestPendingAction(ended, context().now).submissionId).toBe(id(1));
    expect(beginGuestAuth(reopenGuestPendingAction(ended, context().now), { id: id(10), provider: "google" }, context().now).authAttempt?.id).toBe(id(10));
  });

  it("GUEST-05 dismissal does not erase draft binding and requires an explicit re-open before another auth attempt", () => {
    const dismissed = dismissGuestPendingAction(pending(), context().now);
    expect(dismissed.phase).toBe("dismissed");
    expect(dismissed.autoResume).toBe(false);
    expect(dismissed.payload.text).toBe(draft);
    expect(reopenGuestPendingAction(dismissed, context().now).phase).toBe("pending_auth");
  });

  it("CLAIM-14 follows auth then claim then validates every current resume binding", () => {
    const action = claimed();
    expect(action.phase).toBe("claimed");
    expect(validateGuestActionResume(action, context())).toEqual({ ok: true });
    expect(beginGuestActionResume(action, context()).phase).toBe("resume_pending");
    expect(validateGuestActionResume(action, { ...context(), draftDigest: sha256Hex("edited") })).toEqual({ ok: false, code: "draft" });
    expect(validateGuestActionResume(action, { ...context(), principalEpoch: 4 })).toEqual({ ok: false, code: "principal" });
    expect(validateGuestActionResume(action, { ...context(), viewEpoch: 9 })).toEqual({ ok: false, code: "view" });
    expect(validateGuestActionResume(action, { ...context(), conversationVersion: 5 })).toEqual({ ok: false, code: "view" });
    expect(validateGuestActionResume(action, { ...context(), sessionActive: false })).toEqual({ ok: false, code: "session" });
    expect(validateGuestActionResume(action, { ...context(), budgetAllowed: false })).toEqual({ ok: false, code: "budget" });
  });

  it("AUTH-14 permits a credential refresh but rejects principal or view replacement", () => {
    const action = claimed();
    expect(validateGuestActionResume(action, { ...context(), credentialGeneration: 18 })).toEqual({ ok: true });
    expect(validateGuestActionResume(action, { ...context(), principalEpoch: 4, credentialGeneration: 18 })).toEqual({ ok: false, code: "principal" });
    expect(validateGuestActionResume(action, { ...context(), viewEpoch: 9, credentialGeneration: 18 })).toEqual({ ok: false, code: "view" });
  });

  it("CLAIM-15 suppresses automatic continuation after dismissal even when claim already succeeded", () => {
    const action = dismissGuestPendingAction(claimed(), context().now);
    expect(action.phase).toBe("claimed");
    expect(validateGuestActionResume(action, context())).toEqual({ ok: false, code: "dismissed" });
  });

  it("CLAIM-15 makes post-auth and post-claim dismissal explicit-send resumable without minting a claim or submission identity", () => {
    const authenticated = completeGuestAuth(beginGuestAuth(pending(), { id: id(6), provider: "email" }, context().now), id(6), id(7), context().now);
    const dismissedAuthenticated = dismissGuestPendingAction(authenticated, context().now);
    expectRoundTrip(dismissedAuthenticated);
    expect(dismissedAuthenticated).toMatchObject({ phase: "authenticated", autoResume: false, authenticatedAccountId: id(7), claim: null });
    expect(reopenGuestPendingAction(dismissedAuthenticated, context().now)).toMatchObject({ phase: "authenticated", autoResume: true, submissionId: id(1) });

    const claiming = beginGuestClaim(authenticated, id(8), context().now);
    const dismissedClaiming = dismissGuestPendingAction(claiming, context().now);
    const reopenedClaiming = reopenGuestPendingAction(dismissedClaiming, context().now);
    expectRoundTrip(dismissedClaiming);
    expect(reopenedClaiming).toMatchObject({ phase: "claim_pending", autoResume: true, claim: { requestId: id(8) } });
    expect(retryGuestClaim(reopenedClaiming, context().now)).toEqual(reopenedClaiming);

    const dismissedClaimed = dismissGuestPendingAction(claimed(), context().now);
    const reopenedClaimed = reopenGuestPendingAction(dismissedClaimed, context().now);
    expectRoundTrip(dismissedClaimed);
    expect(reopenedClaimed).toMatchObject({ phase: "claimed", autoResume: true, submissionId: id(1), claim: { requestId: id(8) } });
    expect(beginGuestActionResume(reopenedClaimed, context())).toMatchObject({ phase: "resume_pending", submissionId: id(1), claim: { requestId: id(8) } });
  });

  it("CLAIM-14 records a dispatched continuation exactly once", () => {
    const resuming = beginGuestActionResume(claimed(), context());
    const dispatched = markGuestActionDispatched(resuming, continuationDispatched(), context().now);
    expect(dispatched).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), autoResume: false });
    expect(() => markGuestActionDispatched(dispatched, continuationDispatched({ receiptId: id(10) }), context().now)).toThrow("current state");
  });

  it("AUTH-14 keeps dispatched and rejected terminal evidence strict-decoder-valid after expiry", () => {
    const resuming = beginGuestActionResume(claimed(), context());
    const dispatched = markGuestActionDispatched(resuming, continuationDispatched(), context().now);
    const rejected = rejectGuestPendingAction(resuming, continuationRejected(), context().now);
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    for (const terminal of [dispatched, rejected]) {
      const unchanged = expireGuestPendingAction(terminal, afterExpiry);
      expect(unchanged).toEqual(terminal);
      expectRoundTrip(unchanged);
    }
    expect(dispatched).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), autoResume: false });
    expect(rejected).toMatchObject({ phase: "rejected", rejectionCode: "authority_denied", autoResume: false });
  });

  it("CLAIM-14 expires an uncertain submitted continuation into reconcile-only state without erasing its identity", () => {
    const resuming = beginGuestActionResume(claimed(), context());
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    const expired = expireGuestPendingAction(resuming, afterExpiry);
    expect(expired).toMatchObject({ phase: "resume_reconcile", autoResume: false, submissionId: id(1), claim: { requestId: id(8) } });
    expectRoundTrip(expired);
    expect(guestPendingActionNeedsReconciliation(expired, afterExpiry)).toBe(true);
    expect(() => beginGuestActionResume(expired, { ...context(), now: afterExpiry })).toThrow("expired");

    // A delayed server acknowledgement belongs to the original submission and
    // can be durably recorded; no second admission/continuation is attempted.
    const reconciled = markGuestActionDispatched(expired, continuationDispatched(), afterExpiry);
    expect(reconciled).toMatchObject({ phase: "dispatched", submissionId: id(1), dispatchReceiptId: id(9), autoResume: false });
    expectRoundTrip(reconciled);
    expect(() => markGuestActionDispatched(reconciled, continuationDispatched({ receiptId: id(10) }), afterExpiry)).toThrow("current state");
  });

  it("CLAIM-14 rejects stale continuation outcomes without terminalizing the reconcile-only submission", () => {
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    const reconciling = expireGuestPendingAction(beginGuestActionResume(claimed(), context()), afterExpiry);

    expect(() => markGuestActionDispatched(reconciling, continuationDispatched({ submissionId: id(10) }), afterExpiry)).toThrow("could not be confirmed");
    expect(() => markGuestActionDispatched(reconciling, continuationDispatched({ claimRequestId: id(10) }), afterExpiry)).toThrow("could not be confirmed");
    expect(() => markGuestActionDispatched(reconciling, continuationDispatched({ accountId: id(10) }), afterExpiry)).toThrow("could not be confirmed");
    expect(() => markGuestActionDispatched(reconciling, continuationDispatched({ conversationId: id(10) }), afterExpiry)).toThrow("could not be confirmed");
    expect(() => markGuestActionDispatched(reconciling, continuationDispatched({ conversationVersion: 5 }), afterExpiry)).toThrow("could not be confirmed");
    expect(() => rejectGuestPendingAction(reconciling, continuationRejected({ submissionId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, continuationRejected({ claimRequestId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, continuationRejected({ accountId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, continuationRejected({ conversationId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, continuationRejected({ conversationVersion: 5 }), afterExpiry)).toThrow("did not match");
    expect(reconciling).toMatchObject({ phase: "resume_reconcile", submissionId: id(1), claim: { requestId: id(8) } });
    expectRoundTrip(reconciling);

    const accepted = markGuestActionDispatched(reconciling, continuationDispatched(), afterExpiry);
    expect(accepted).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), submissionId: id(1) });
    expectRoundTrip(accepted);
  });

  it("CLAIM-14 reconciles a delayed claim success after expiry without permitting a retry or continuation", () => {
    const authenticated = completeGuestAuth(beginGuestAuth(pending(), { id: id(6), provider: "apple" }, context().now), id(6), id(7), context().now);
    const claimPending = beginGuestClaim(authenticated, id(8), context().now);
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    const reconciling = expireGuestPendingAction(claimPending, afterExpiry);
    expect(reconciling).toMatchObject({ phase: "claim_reconcile", autoResume: false, submissionId: id(1), claim: { requestId: id(8) } });
    expectRoundTrip(reconciling);
    expect(guestPendingActionNeedsReconciliation(reconciling, afterExpiry)).toBe(true);
    expect(() => retryGuestClaim(reconciling, afterExpiry)).toThrow("expired");
    expect(() => reopenGuestPendingAction(reconciling, afterExpiry)).toThrow("expired");
    expect(() => beginGuestActionResume(reconciling, { ...context(), now: afterExpiry })).toThrow("expired");

    const claimedLate = completeGuestClaim(reconciling, claimAccepted(), afterExpiry);
    expect(claimedLate).toMatchObject({ phase: "claimed", autoResume: false, submissionId: id(1), claim: { requestId: id(8) } });
    expectRoundTrip(claimedLate);
    expect(validateGuestActionResume(claimedLate, { ...context(), now: afterExpiry })).toEqual({ ok: false, code: "expired" });
  });

  it("CLAIM-14 ignores stale claim outcomes unless every saved member/conversation binding matches", () => {
    const authenticated = completeGuestAuth(beginGuestAuth(pending(), { id: id(6), provider: "apple" }, context().now), id(6), id(7), context().now);
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    const reconciling = expireGuestPendingAction(beginGuestClaim(authenticated, id(8), context().now), afterExpiry);
    expect(() => completeGuestClaim(reconciling, claimAccepted({ submissionId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => completeGuestClaim(reconciling, claimAccepted({ requestId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, claimRejected({ submissionId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, claimRejected({ requestId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, claimRejected({ accountId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, claimRejected({ conversationId: id(10) }), afterExpiry)).toThrow("did not match");
    expect(() => rejectGuestPendingAction(reconciling, claimRejected({ conversationVersion: 5 }), afterExpiry)).toThrow("did not match");
    expect(reconciling).toMatchObject({ phase: "claim_reconcile", submissionId: id(1), claim: { requestId: id(8) } });
    expectRoundTrip(reconciling);

    const rejected = rejectGuestPendingAction(reconciling, claimRejected(), afterExpiry);
    expect(rejected).toMatchObject({ phase: "rejected", autoResume: false, submissionId: id(1), rejectionCode: "authority_denied", claim: { requestId: id(8), accountId: id(7) } });
    expectRoundTrip(rejected);
  });

  it("CLAIM-14 records only a delayed rejection for an expired in-flight continuation", () => {
    const resuming = beginGuestActionResume(claimed(), context());
    const afterExpiry = new Date("2026-09-21T12:01:00.000Z");
    const reconciling = expireGuestPendingAction(resuming, afterExpiry);
    const rejected = rejectGuestPendingAction(reconciling, continuationRejected(), afterExpiry);
    expect(rejected).toMatchObject({ phase: "rejected", autoResume: false, submissionId: id(1), rejectionCode: "authority_denied", claim: { requestId: id(8) } });
    expectRoundTrip(rejected);
    expect(() => beginGuestAuth(reconciling, { id: id(10), provider: "email" }, afterExpiry)).toThrow("expired");
    expect(() => markGuestActionDispatched(rejected, continuationDispatched(), afterExpiry)).toThrow("current state");
  });

  it("AUTH-14 round-trips each transition across provider cancellation, claim retry, dismissal, terminal cancellation, rejection, and duplicate acknowledgement", () => {
    const opening = beginGuestAuth(pending(), { id: id(6), provider: "google" }, context().now);
    const providerCancelled = cancelGuestAuthAttempt(opening, id(6), context().now);
    const authenticated = completeGuestAuth(beginGuestAuth(providerCancelled, { id: id(10), provider: "email" }, context().now), id(10), id(7), context().now);
    const claimPending = beginGuestClaim(authenticated, id(8), context().now);
    const retry = retryGuestClaim(claimPending, context().now);
    const completed = completeGuestClaim(retry, claimAccepted(), context().now);
    const resumed = beginGuestActionResume(completed, context());
    const dispatched = markGuestActionDispatched(resumed, continuationDispatched(), context().now);
    const terminalCancelled = cancelGuestPendingAction(completed, context().now);
    const terminalRejected = rejectGuestPendingAction(resumed, continuationRejected({ rejectionCode: "intent_stale" }), context().now);
    const dismissed = dismissGuestPendingAction(completed, context().now);
    for (const action of [pending(), opening, providerCancelled, authenticated, claimPending, retry, completed, resumed, dispatched, terminalCancelled, terminalRejected, dismissed, reopenGuestPendingAction(dismissed, context().now)]) expectRoundTrip(action);
    expect(() => markGuestActionDispatched(dispatched, continuationDispatched({ receiptId: id(10) }), context().now)).toThrow("current state");
  });

  it("AUTH-14 turns expired journals into a terminal expired state without minting a new action", () => {
    const action = pending();
    const expired = dismissGuestPendingAction(action, new Date("2026-09-21T12:00:00.000Z"));
    expect(expired).toMatchObject({ phase: "expired", submissionId: id(1), payload: action.payload });
    expectRoundTrip(expired);
    expect(() => beginGuestAuth(expired, { id: id(6), provider: "email" }, new Date("2026-09-21T12:01:00.000Z"))).toThrow("expired");
  });
});
