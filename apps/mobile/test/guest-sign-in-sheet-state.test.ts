import { describe, expect, it } from "vitest";
import {
  initialGuestSignInSheetState,
  reduceGuestSignInSheet,
  type GuestProviderAvailability,
} from "../src/auth/guest-sign-in-sheet-state";

const providers: Record<"apple" | "google" | "email", GuestProviderAvailability> = {
  apple: { available: false, unavailableReason: "Apple sign-in is not configured on this build." },
  google: { available: true },
  email: { available: true },
};

describe("guest sign-in sheet presentation state", () => {
  it("does not pretend an unavailable provider started authentication", () => {
    const result = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "choose_provider", provider: "apple" }, providers);
    expect(result).toMatchObject({ step: "chooser", provider: null, error: "Apple sign-in is not configured on this build." });
  });

  it("keeps email/code transport adapter-driven rather than creating a local session", () => {
    const email = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "choose_provider", provider: "email" }, providers);
    const edited = reduceGuestSignInSheet(email, { type: "edit_email", email: "person@example.com" }, providers);
    const sending = reduceGuestSignInSheet(edited, { type: "begin_email_code" }, providers);
    expect(sending).toMatchObject({ step: "sending_code", provider: "email", email: "person@example.com" });
    const code = reduceGuestSignInSheet(sending, { type: "email_code_sent", email: "person@example.com" }, providers);
    const checking = reduceGuestSignInSheet(code, { type: "begin_code_verification" }, providers);
    expect(checking).toMatchObject({ step: "verifying_code", provider: "email", email: "person@example.com", error: null });
    const expired = reduceGuestSignInSheet(checking, { type: "recoverable_error", message: "That code has expired." }, providers);
    expect(expired).toMatchObject({ step: "error", retryStep: "code", error: "That code has expired." });
    expect(reduceGuestSignInSheet(expired, { type: "retry" }, providers)).toMatchObject({ step: "code", email: "person@example.com", error: null });
  });

  it("models provider cancellation and claim progress without losing the selected email", () => {
    const pending = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "choose_provider", provider: "google" }, providers);
    expect(reduceGuestSignInSheet(pending, { type: "provider_cancelled" }, providers)).toMatchObject({ step: "chooser", provider: null });
    const email = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "email_code_sent", email: "person@example.com" }, providers);
    const claim = reduceGuestSignInSheet(email, { type: "begin_claim" }, providers);
    expect(claim).toMatchObject({ step: "claiming", provider: "email", email: "person@example.com", error: null });
  });

  it("does not invent authentication or claim success from a provider choice", () => {
    const waiting = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "choose_provider", provider: "google" }, providers);
    expect(waiting).toMatchObject({ step: "provider_pending", provider: "google" });
    const failed = reduceGuestSignInSheet(waiting, { type: "recoverable_error", message: "Google cancelled the request." }, providers);
    expect(failed).toMatchObject({ step: "error", retryStep: "chooser", provider: "google" });
    expect(reduceGuestSignInSheet(failed, { type: "retry" }, providers)).toMatchObject({ step: "chooser", provider: null });
    // Only the host's verified-identity/claim callback can issue begin_claim.
    expect(reduceGuestSignInSheet(waiting, { type: "provider_cancelled" }, providers)).toMatchObject({ step: "chooser", provider: null });
  });

  it("returns a failed code delivery to the email field rather than a stale code form", () => {
    const email = reduceGuestSignInSheet(initialGuestSignInSheetState(), { type: "email_code_sent", email: "person@example.com" }, providers);
    const sending = reduceGuestSignInSheet(email, { type: "begin_email_code" }, providers);
    const failed = reduceGuestSignInSheet(sending, { type: "recoverable_error", message: "Email is temporarily unavailable." }, providers);
    expect(failed).toMatchObject({ step: "error", retryStep: "email", email: "person@example.com" });
    expect(reduceGuestSignInSheet(failed, { type: "retry" }, providers)).toMatchObject({ step: "email", email: "person@example.com", error: null });
  });
});
