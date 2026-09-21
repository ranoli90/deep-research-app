import { describe, expect, it } from "vitest";
import {
  beginGuestActionResume, beginGuestAuth, beginGuestClaim, cancelGuestAuthAttempt, completeGuestAuth, completeGuestClaim,
  createGuestPendingAction, dismissGuestPendingAction, markGuestActionDispatched, readGuestPendingAction,
  reopenGuestPendingAction, validateGuestActionResume,
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
function claimed() {
  const auth = completeGuestAuth(beginGuestAuth(pending(), { id: id(6), provider: "apple" }, context().now), id(6), id(7), context().now);
  return completeGuestClaim(beginGuestClaim(auth, id(8), context().now), {
    requestId: id(8), accountId: id(7), controlVersion: 12, conversationId: id(3), conversationVersion: 4,
    principalEpoch: 3, viewEpoch: 8,
  }, context().now);
}

describe("guest pending action", () => {
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
    ]) expect(() => readGuestPendingAction(changed)).toThrow("Saved sign-in action is invalid");
  });

  it("PROVIDER-02 preserves the exact action on cancellation and ignores a late callback", () => {
    const opening = beginGuestAuth(pending(), { id: id(6), provider: "google" }, context().now);
    const returned = cancelGuestAuthAttempt(opening, id(6), context().now);
    expect(returned.phase).toBe("pending_auth");
    expect(returned.payload).toEqual(opening.payload);
    expect(() => completeGuestAuth(returned, id(6), id(7), context().now)).toThrow("current state");
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

  it("CLAIM-14 records a dispatched continuation exactly once", () => {
    const resuming = beginGuestActionResume(claimed(), context());
    const dispatched = markGuestActionDispatched(resuming, id(9), context().now);
    expect(dispatched).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), autoResume: false });
    expect(() => markGuestActionDispatched(dispatched, id(10), context().now)).toThrow("current state");
  });

  it("AUTH-14 turns expired journals into a terminal expired state without minting a new action", () => {
    const action = pending();
    const expired = dismissGuestPendingAction(action, new Date("2026-09-21T12:00:00.000Z"));
    expect(expired).toMatchObject({ phase: "expired", submissionId: id(1), payload: action.payload });
    expect(() => beginGuestAuth(expired, { id: id(6), provider: "email" }, new Date("2026-09-21T12:01:00.000Z"))).toThrow("expired");
  });
});
