import { describe, expect, it } from "vitest";
import {
  guestEmailCanResend,
  guestSignInBusy,
  initialGuestSignInSheetState,
  reduceGuestSignInSheet,
  type GuestProviderAvailability,
  type GuestSignInAttempt,
} from "../src/auth/guest-sign-in-sheet-state";

const providers: Record<"apple" | "google" | "email", GuestProviderAvailability> = {
  apple: { available: false, unavailableReason: "Apple sign-in is not configured on this build." },
  google: { available: true },
  email: { available: true },
};
const attempt = (operation: GuestSignInAttempt["operation"], provider: GuestSignInAttempt["provider"] = "email", email: string | null = provider === "email" ? "person@example.com" : null): GuestSignInAttempt => ({
  id: `durable-${operation}`, operation, provider, email,
});
const reduce = (state: ReturnType<typeof initialGuestSignInSheetState>, event: Parameters<typeof reduceGuestSignInSheet>[1]) => reduceGuestSignInSheet(state, event, providers);

describe("guest sign-in sheet presentation state", () => {
  it("does not pretend an unavailable provider started authentication", () => {
    const result = reduce(initialGuestSignInSheetState(), { type: "choose_provider", provider: "apple" });
    expect(result).toMatchObject({ step: "chooser", provider: null, sessionTask: null, error: "Apple sign-in is not configured on this build." });
  });

  it("requires an opaque durable attempt before provider, email, or code work is marked busy", () => {
    const provider = reduce(initialGuestSignInSheetState(), { type: "begin_provider", provider: "google", attempt: attempt("provider", "google") });
    expect(provider).toMatchObject({ step: "provider_pending", sessionTask: { kind: "provider", attempt: { id: "durable-provider" } } });
    expect(guestSignInBusy(provider)).toBe(true);
    const sending = reduce(reduce(initialGuestSignInSheetState(), { type: "edit_email", email: "person@example.com" }), { type: "begin_email_code", attempt: attempt("email_code") });
    expect(sending).toMatchObject({ step: "sending_code", sessionTask: { kind: "email_code" } });
    expect(() => reduce(initialGuestSignInSheetState(), { type: "begin_provider", provider: "google", attempt: { ...attempt("provider", "google"), id: "" } })).toThrow("durable sign-in attempt");
  });

  it("models code delivery, cooldown, rate limiting, expiry, and manual retry without inventing a session", () => {
    const sending = reduce(initialGuestSignInSheetState(), { type: "begin_email_code", attempt: attempt("email_code") });
    const code = reduce(sending, { type: "email_code_sent", email: "person@example.com", resendRetryAt: "2026-09-20T20:10:00.000Z" });
    expect(code).toMatchObject({ step: "code", sessionTask: null, resend: { status: "cooldown" } });
    expect(guestEmailCanResend(code, new Date("2026-09-20T20:09:59.000Z"))).toBe(false);
    expect(guestEmailCanResend(code, new Date("2026-09-20T20:10:00.000Z"))).toBe(true);
    const limited = reduce(code, { type: "resend_rate_limited", retryAt: "2026-09-20T20:11:00.000Z", message: "Please wait before resending." });
    expect(limited).toMatchObject({ step: "error", retryStep: "code", resend: { status: "rate_limited" } });
    const expired = reduce(limited, { type: "code_expired", message: "That code expired." });
    expect(expired).toMatchObject({ step: "error", retryStep: "email", codeExpired: true, sessionTask: null });
    expect(reduce(expired, { type: "retry" })).toMatchObject({ step: "email", codeExpired: true });
  });

  it("keeps reconciliation distinct from retry and blocks any busy-path duplicate continuation", () => {
    const reconciling = reduce(initialGuestSignInSheetState(), { type: "begin_reconcile", attempt: attempt("reconcile") });
    expect(reconciling).toMatchObject({ step: "reconciling", retryStep: "reconciling", sessionTask: { kind: "reconcile" } });
    expect(guestSignInBusy(reconciling)).toBe(true);
    const failure = reduce(reconciling, { type: "recoverable_error", message: "Connection was interrupted." });
    expect(failure).toMatchObject({ step: "error", retryStep: "reconciling", sessionTask: null });
    // The host must reconcile the original durable ID; this reducer has no dispatch outcome.
    expect(reduce(failure, { type: "retry" })).toMatchObject({ step: "reconciling", sessionTask: null });
  });

  it("models guest expiry/deletion as terminal presentation states and leaves no active task", () => {
    const provider = reduce(initialGuestSignInSheetState(), { type: "begin_provider", provider: "google", attempt: attempt("provider", "google") });
    expect(reduce(provider, { type: "guest_expired", message: "The guest access window ended." })).toMatchObject({ step: "expired", sessionTask: null, error: "The guest access window ended." });
    expect(reduce(provider, { type: "guest_deleted", message: "The conversation was deleted." })).toMatchObject({ step: "deleted", sessionTask: null, error: "The conversation was deleted." });
  });

  it("only clears the presentation task after the host has made dismissal durable", () => {
    const active = reduce(initialGuestSignInSheetState(), { type: "begin_code_verification", attempt: attempt("verify_email_code") });
    const dismissed = reduce(active, { type: "dismissed" });
    expect(dismissed).toMatchObject({ step: "verifying_code", sessionTask: null });
    // It deliberately does not report an auth/claim/continuation success.
    expect(dismissed.step).not.toBe("claiming");
  });
});
