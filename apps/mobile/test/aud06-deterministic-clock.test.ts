import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGuestActionResume,
  beginGuestAuth,
  beginGuestClaim,
  cancelGuestPendingAction,
  completeGuestAuth,
  completeGuestClaim,
  confirmMemberClarificationRegistration,
  createGuestPendingAction,
  dismissGuestPendingAction,
  expireGuestPendingAction,
  guestPendingActionNeedsReconciliation,
  markGuestActionDispatched,
  pendingActionExpired,
  prepareMemberClarificationReplacement,
  readGuestPendingAction,
  reopenGuestPendingAction,
  retryGuestClaim,
  validateGuestActionResume,
  type GuestClaimAcceptedOutcome,
  type GuestContinuationDispatchedOutcome,
} from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

// AUD06 deterministic-clock held-out suite. The fixture deadline is immutable
// and is never moved forward here; tests control `now`, never `expiresAt`.
const FROZEN_BEFORE = new Date("2026-09-21T01:00:00.000Z");
const HOST_JOURNEY_AT = new Date("2026-09-21T08:00:00.000Z");
const AT_DEADLINE = new Date("2026-09-22T00:00:00.000Z");
const PAST_DEADLINE = new Date("2026-09-22T00:00:01.000Z");
const HOST_PAST_FIXTURE = new Date("2026-09-23T12:00:00.000Z");
const FIXTURE_EXPIRES_AT = "2026-09-22T00:00:00.000Z";
const FIXTURE_CREATED_AT = "2026-09-21T00:00:00.000Z";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = "Second message";

function pendingFollowUp() {
  return createGuestPendingAction({
    submissionId: id(1),
    guestContextId: id(2),
    conversationId: id(3),
    conversationVersion: 1,
    draftRevision: 1,
    draftDigest: sha256Hex(draft),
    payload: { kind: "follow_up", text: draft, parentRunId: id(4) },
    consentPolicyVersion: "consent.v1",
    createdAt: FIXTURE_CREATED_AT,
    expiresAt: FIXTURE_EXPIRES_AT,
  });
}

function claimAccepted(): GuestClaimAcceptedOutcome {
  return {
    type: "claim_accepted",
    submissionId: id(1),
    requestId: id(8),
    accountId: id(7),
    controlVersion: 12,
    conversationId: id(3),
    conversationVersion: 1,
    principalEpoch: 3,
    viewEpoch: 8,
  };
}

function continuationDispatched(): GuestContinuationDispatchedOutcome {
  return {
    type: "continuation_dispatched",
    submissionId: id(1),
    claimRequestId: id(8),
    accountId: id(7),
    conversationId: id(3),
    conversationVersion: 1,
    receiptId: id(9),
    runId: id(10),
    memberConversationId: id(11),
  };
}

function resumeContext(now: Date) {
  return {
    now,
    accountId: id(7),
    sessionActive: true,
    guestContextId: id(2),
    conversationId: id(3),
    conversationVersion: 1,
    controlVersion: 12,
    principalEpoch: 3,
    viewEpoch: 8,
    credentialGeneration: 17,
    draftRevision: 1,
    draftDigest: sha256Hex(draft),
    consentPolicyVersion: "consent.v1",
    authorityAllowed: true,
    budgetAllowed: true,
  };
}

function expectRoundTrip(action: unknown) {
  expect(readGuestPendingAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AUD06 deterministic clocks", () => {
  it("C1 frozen-clock green: pure journal transitions before deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_BEFORE);
    try {
      const action = pendingFollowUp();
      const now = new Date();
      expect(now.toISOString()).toBe(FROZEN_BEFORE.toISOString());
      const authenticating = beginGuestAuth(action, { id: id(6), provider: "email" }, new Date());
      const authenticated = completeGuestAuth(authenticating, id(6), id(7), new Date());
      const claiming = beginGuestClaim(authenticated, id(8), new Date());
      const claimed = completeGuestClaim(claiming, claimAccepted(), new Date());
      expect(validateGuestActionResume(claimed, resumeContext(new Date()))).toEqual({ ok: true });
      const resuming = beginGuestActionResume(claimed, resumeContext(new Date()));
      const dispatched = markGuestActionDispatched(resuming, continuationDispatched(), new Date());
      expect(dispatched).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), submissionId: id(1) });
      expectRoundTrip(dispatched);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("C2 frozen-clock green: device cancel/replace + clarification replacement shapes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOST_JOURNEY_AT);
    try {
      // Device cancel/replace shape (guest-device.test.ts:61-74 anchors).
      const first = pendingFollowUp();
      const cancelled = cancelGuestPendingAction(first, new Date());
      expect(cancelled.phase).toBe("cancelled");
      const second = createGuestPendingAction({
        submissionId: id(8),
        guestContextId: id(2),
        conversationId: id(3),
        conversationVersion: 1,
        draftRevision: 2,
        draftDigest: sha256Hex("Edited B"),
        payload: { kind: "new_research", text: "Edited B" },
        consentPolicyVersion: "consent.v1",
        createdAt: new Date().toISOString(),
        expiresAt: FIXTURE_EXPIRES_AT,
      });
      expect(second.phase).toBe("pending_auth");
      expectRoundTrip(second);

      // Clarification replacement shape (guest-app.component.test.tsx:821-822 anchors).
      const clarification = createGuestPendingAction({
        submissionId: id(3),
        guestContextId: id(2),
        conversationId: id(3),
        conversationVersion: 1,
        draftRevision: 0,
        draftDigest: sha256Hex("A"),
        payload: { kind: "clarification", text: "A", pendingInputId: id(5), briefRevision: 9, field: "geography" },
        consentPolicyVersion: "consent.v1",
        createdAt: FIXTURE_CREATED_AT,
        expiresAt: FIXTURE_EXPIRES_AT,
      });
      const auth = completeGuestAuth(
        beginGuestAuth(clarification, { id: id(6), provider: "email" }, new Date()),
        id(6),
        id(7),
        new Date(),
      );
      const claimed = completeGuestClaim(beginGuestClaim(auth, id(9), new Date()), {
        type: "claim_accepted",
        submissionId: id(3),
        requestId: id(9),
        accountId: id(7),
        controlVersion: 1,
        conversationId: id(3),
        conversationVersion: 1,
        principalEpoch: 1,
        viewEpoch: 1,
      }, new Date());
      const abandoned = cancelGuestPendingAction(claimed, new Date());
      const replacement = prepareMemberClarificationReplacement(
        abandoned,
        { kind: "clarification", text: "B", pendingInputId: id(5), briefRevision: 9, field: "geography" },
        id(10),
        1,
        new Date(),
        { principalEpoch: 1, viewEpoch: 1 },
      );
      expect(replacement).toMatchObject({ phase: "member_register_pending", submissionId: id(10) });
      expectRoundTrip(replacement);
      const registered = confirmMemberClarificationRegistration(replacement, {
        type: "member_action_registered",
        submissionId: id(10),
        claimRequestId: id(9),
        controlVersion: 1,
        payloadDigest: replacement.payloadDigest,
        expiresAt: FIXTURE_EXPIRES_AT,
      }, new Date());
      expect(registered.phase).toBe("member_claimed");
      expectRoundTrip(registered);
    } finally {
      vi.useRealTimers();
    }
  });

  it("C3 explicit expiry-advance denial: advancing now denies, deadline never moves", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_BEFORE);
    try {
      const pending = pendingFollowUp();
      const authenticated = completeGuestAuth(
        beginGuestAuth(pending, { id: id(6), provider: "apple" }, new Date()),
        id(6),
        id(7),
        new Date(),
      );
      const claiming = beginGuestClaim(authenticated, id(8), new Date());
      const claimed = completeGuestClaim(claiming, claimAccepted(), new Date());
      const resuming = beginGuestActionResume(claimed, resumeContext(new Date()));
      const dismissed = dismissGuestPendingAction(pendingFollowUp(), new Date());

      for (const advanced of [AT_DEADLINE, PAST_DEADLINE]) {
        vi.setSystemTime(advanced);
        const now = new Date();
        expect(pendingActionExpired(pendingFollowUp(), now)).toBe(true);
        expect(validateGuestActionResume(claimed, resumeContext(now))).toEqual({ ok: false, code: "expired" });
        expect(() => beginGuestActionResume(claimed, resumeContext(now))).toThrow(/expired/);
        expect(() => beginGuestAuth(pendingFollowUp(), { id: id(6), provider: "email" }, now)).toThrow(/expired/);
        expect(() => retryGuestClaim(claiming, now)).toThrow(/expired/);
        expect(() => reopenGuestPendingAction(dismissed, now)).toThrow(/expired/);

        // Dismiss-after-expiry terminalizes; in-flight claim/resume map to reconcile-only.
        const dismissedLate = dismissGuestPendingAction(pendingFollowUp(), now);
        expect(dismissedLate.phase).toBe("expired");
        const claimReconciling = expireGuestPendingAction(claiming, now);
        expect(claimReconciling).toMatchObject({
          phase: "claim_reconcile",
          autoResume: false,
          submissionId: id(1),
          claim: { requestId: id(8) },
        });
        const resumeReconciling = expireGuestPendingAction(resuming, now);
        expect(resumeReconciling).toMatchObject({
          phase: "resume_reconcile",
          autoResume: false,
          submissionId: id(1),
          claim: { requestId: id(8) },
        });
        expectRoundTrip(claimReconciling);
        expectRoundTrip(resumeReconciling);
      }
      // The deadline itself never moved: every fixture still carries 2026-09-22.
      expect(pendingFollowUp().expiresAt).toBe(FIXTURE_EXPIRES_AT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("C4 reconcile-only after expiry preserves identity and forbids retry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_BEFORE);
    try {
      const authenticated = completeGuestAuth(
        beginGuestAuth(pendingFollowUp(), { id: id(6), provider: "apple" }, new Date()),
        id(6),
        id(7),
        new Date(),
      );
      const claimPending = beginGuestClaim(authenticated, id(8), new Date());
      const claimed = completeGuestClaim(claimPending, claimAccepted(), new Date());
      const resuming = beginGuestActionResume(claimed, resumeContext(new Date()));

      vi.setSystemTime(PAST_DEADLINE);
      const now = new Date();

      const claimReconciling = expireGuestPendingAction(claimPending, now);
      expect(claimReconciling).toMatchObject({ phase: "claim_reconcile", autoResume: false });
      expect(guestPendingActionNeedsReconciliation(claimReconciling, now)).toBe(true);
      expect(() => retryGuestClaim(claimReconciling, now)).toThrow("expired");
      expect(() => reopenGuestPendingAction(claimReconciling, now)).toThrow("expired");
      expect(() => beginGuestActionResume(claimReconciling, resumeContext(now))).toThrow("expired");
      expect(() => completeGuestClaim(claimReconciling, { ...claimAccepted(), submissionId: id(10) }, now)).toThrow("did not match");
      expect(() => completeGuestClaim(claimReconciling, { ...claimAccepted(), requestId: id(10) }, now)).toThrow("did not match");
      const claimedLate = completeGuestClaim(claimReconciling, claimAccepted(), now);
      expect(claimedLate).toMatchObject({ phase: "claimed", submissionId: id(1), claim: { requestId: id(8) } });
      expect(validateGuestActionResume(claimedLate, resumeContext(now))).toEqual({ ok: false, code: "expired" });
      expectRoundTrip(claimedLate);

      const resumeReconciling = expireGuestPendingAction(resuming, now);
      expect(resumeReconciling).toMatchObject({ phase: "resume_reconcile", autoResume: false });
      expect(guestPendingActionNeedsReconciliation(resumeReconciling, now)).toBe(true);
      expect(() => markGuestActionDispatched(resumeReconciling, { ...continuationDispatched(), submissionId: id(10) }, now)).toThrow("could not be confirmed");
      expect(() => markGuestActionDispatched(resumeReconciling, { ...continuationDispatched(), claimRequestId: id(10) }, now)).toThrow("could not be confirmed");
      const dispatched = markGuestActionDispatched(resumeReconciling, continuationDispatched(), now);
      expect(dispatched).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), submissionId: id(1) });
      expectRoundTrip(dispatched);

      // Terminal evidence stays strict-decoder-valid and unchanged after expiry.
      const terminal = markGuestActionDispatched(
        beginGuestActionResume(completeGuestClaim(beginGuestClaim(completeGuestAuth(
          beginGuestAuth(pendingFollowUp(), { id: id(6), provider: "apple" }, FROZEN_BEFORE),
          id(6),
          id(7),
          FROZEN_BEFORE,
        ), id(8), FROZEN_BEFORE), claimAccepted(), FROZEN_BEFORE), resumeContext(FROZEN_BEFORE)),
        continuationDispatched(),
        FROZEN_BEFORE,
      );
      expect(expireGuestPendingAction(terminal, now)).toEqual(terminal);
      expectRoundTrip(expireGuestPendingAction(terminal, now));
    } finally {
      vi.useRealTimers();
    }
  });

  it("C5 clock-restore isolation: suite leaves no fake-clock residue", () => {
    const realBefore = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_BEFORE);
    try {
      expect(new Date().toISOString()).toBe(FROZEN_BEFORE.toISOString());
      vi.setSystemTime(PAST_DEADLINE);
      expect(new Date().toISOString()).toBe(PAST_DEADLINE.toISOString());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    if (typeof vi.isFakeTimers === "function") expect(vi.isFakeTimers()).toBe(false);
    // The host clock is real again: it no longer reports either fake anchor.
    expect(new Date().toISOString()).not.toBe(FROZEN_BEFORE.toISOString());
    expect(new Date().toISOString()).not.toBe(PAST_DEADLINE.toISOString());
    expect(Math.abs(Date.now() - realBefore)).toBeLessThan(60_000);
    // Explicit-now behavior is unaffected by the earlier fake clock.
    const action = beginGuestAuth(pendingFollowUp(), { id: id(6), provider: "email" }, FROZEN_BEFORE);
    expect(action.phase).toBe("authenticating");
    expectRoundTrip(action);
  });

  it("C6 host-date-past-fixture resilience: explicit now stays green, host now fail-closes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOST_PAST_FIXTURE);
    try {
      // (a) Pure functions depend on the passed `now`, not the host clock.
      const beforeDeadline = new Date("2026-09-21T01:00:00.000Z");
      const pending = pendingFollowUp();
      const authenticated = completeGuestAuth(
        beginGuestAuth(pending, { id: id(6), provider: "email" }, beforeDeadline),
        id(6),
        id(7),
        beforeDeadline,
      );
      const claimed = completeGuestClaim(beginGuestClaim(authenticated, id(8), beforeDeadline), claimAccepted(), beforeDeadline);
      expect(validateGuestActionResume(claimed, resumeContext(beforeDeadline))).toEqual({ ok: true });

      // (b) The faked host date itself (2026-09-23, past the fixture deadline) fail-closes.
      const hostNow = new Date();
      expect(hostNow.toISOString()).toBe(HOST_PAST_FIXTURE.toISOString());
      expect(pendingActionExpired(pending, hostNow)).toBe(true);
      expect(validateGuestActionResume(claimed, resumeContext(hostNow))).toEqual({ ok: false, code: "expired" });
      expect(expireGuestPendingAction(pending, hostNow)).toMatchObject({ phase: "expired", submissionId: id(1) });
      expect(expireGuestPendingAction(beginGuestClaim(authenticated, id(8), beforeDeadline), hostNow)).toMatchObject({
        phase: "claim_reconcile",
        submissionId: id(1),
      });
      expect(pending.expiresAt).toBe(FIXTURE_EXPIRES_AT);
    } finally {
      vi.useRealTimers();
    }
  });
});
