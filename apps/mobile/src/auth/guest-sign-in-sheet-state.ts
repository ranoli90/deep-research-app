/**
 * Presentation state for the guest second-send sign-in sheet.
 *
 * The sheet cannot authenticate, claim, or continue an action. Its host only
 * supplies attempts already recorded in the durable guest-action journal.
 */
export type GuestSignInProvider = "apple" | "google" | "email";

export type GuestProviderAvailability = {
  available: boolean;
  /** User-facing setup failure. An unavailable provider can never start auth. */
  unavailableReason?: string;
};

export type GuestSignInOperation = "provider" | "email_code" | "resend_email_code" | "verify_email_code" | "claim" | "reconcile";

/** An opaque durable host/journal identity. The presentation layer never mints one. */
export type GuestSignInAttempt = {
  id: string;
  operation: GuestSignInOperation;
  provider: GuestSignInProvider;
  email: string | null;
};

export type GuestSignInSessionTask = {
  attempt: GuestSignInAttempt;
  /** A host task has started; this never implies auth or claim success. */
  kind: GuestSignInOperation;
};

export type GuestSignInSheetStep =
  | "chooser" | "email" | "sending_code" | "code" | "provider_pending"
  | "verifying_code" | "claiming" | "reconciling" | "error" | "expired" | "deleted";

export type GuestEmailResendState = {
  status: "available" | "cooldown" | "rate_limited";
  /** ISO timestamp from the provider/host; null means a manual retry is available. */
  retryAt: string | null;
};

export type GuestSignInSheetState = {
  step: GuestSignInSheetStep;
  email: string;
  error: string | null;
  /** Where a recoverable failure can safely return. Never an auth outcome. */
  retryStep: "chooser" | "email" | "code" | "claiming" | "reconciling";
  /** Informational only; it is never an auth result. */
  provider: GuestSignInProvider | null;
  /** Present only after a durable host attempt has begun. */
  sessionTask: GuestSignInSessionTask | null;
  resend: GuestEmailResendState;
  /** A stale code must never submit the saved continuation. */
  codeExpired: boolean;
};

export type GuestSignInSheetEvent =
  | { type: "choose_provider"; provider: GuestSignInProvider }
  | { type: "enter_email" }
  | { type: "edit_email"; email: string }
  | { type: "begin_email_code"; attempt: GuestSignInAttempt }
  | { type: "email_code_sent"; email: string; resendRetryAt?: string | null }
  | { type: "enter_code" }
  | { type: "begin_provider"; provider: "apple" | "google"; attempt: GuestSignInAttempt }
  | { type: "begin_code_verification"; attempt: GuestSignInAttempt }
  /** Only a host with verified identity can move to claim progress. */
  | { type: "begin_claim"; attempt: GuestSignInAttempt }
  /** A lost claim/continuation reply is reconciliation, never a resend. */
  | { type: "begin_reconcile"; attempt: GuestSignInAttempt }
  | { type: "resend_rate_limited"; retryAt: string | null; message: string }
  | { type: "code_expired"; message: string }
  | { type: "guest_expired"; message: string }
  | { type: "guest_deleted"; message: string }
  | { type: "recoverable_error"; message: string }
  | { type: "retry" }
  | { type: "provider_cancelled" }
  | { type: "use_different_email" }
  /** Emitted only after the host has durably suppressed automatic continuation. */
  | { type: "dismissed" };

export const initialGuestSignInSheetState = (): GuestSignInSheetState => ({
  step: "chooser", email: "", error: null, retryStep: "chooser", provider: null,
  sessionTask: null, resend: { status: "available", retryAt: null }, codeExpired: false,
});

function chooser(state: GuestSignInSheetState, error: string | null = null): GuestSignInSheetState {
  return { ...state, step: "chooser", provider: null, retryStep: "chooser", error, sessionTask: null };
}

function retryStepFor(state: GuestSignInSheetState): GuestSignInSheetState["retryStep"] {
  if (state.step === "sending_code" || state.step === "email") return "email";
  if (state.step === "code" || state.step === "verifying_code") return "code";
  if (state.step === "claiming") return "claiming";
  if (state.step === "reconciling") return "reconciling";
  return "chooser";
}

function task(attempt: GuestSignInAttempt, kind: GuestSignInOperation): GuestSignInSessionTask {
  // Fail closed on an accidental transport transition without a journal ID.
  if (!attempt.id || attempt.operation !== kind) throw new Error("A durable sign-in attempt is required.");
  return { attempt, kind };
}

/** Strict presentation transitions; the host alone reports verified outcomes. */
export function reduceGuestSignInSheet(
  state: GuestSignInSheetState,
  event: GuestSignInSheetEvent,
  providers: Record<GuestSignInProvider, GuestProviderAvailability>,
): GuestSignInSheetState {
  switch (event.type) {
    case "choose_provider": {
      const availability = providers[event.provider];
      if (!availability?.available) return chooser(state, availability?.unavailableReason ?? "This sign-in option is not available yet.");
      return event.provider === "email"
        ? { ...state, step: "email", provider: "email", retryStep: "email", error: null, sessionTask: null }
        : { ...state, step: "chooser", provider: event.provider, retryStep: "chooser", error: null, sessionTask: null };
    }
    case "enter_email": return { ...state, step: "email", provider: "email", retryStep: "email", error: null, sessionTask: null };
    case "edit_email": return { ...state, email: event.email, error: null };
    case "begin_email_code":
      return { ...state, step: "sending_code", provider: "email", retryStep: "email", error: null, codeExpired: false, sessionTask: task(event.attempt, event.attempt.operation) };
    case "email_code_sent":
      return { ...state, step: "code", provider: "email", email: event.email, retryStep: "code", error: null, sessionTask: null,
        resend: event.resendRetryAt ? { status: "cooldown", retryAt: event.resendRetryAt } : { status: "available", retryAt: null } };
    case "enter_code": return { ...state, step: "code", provider: "email", retryStep: "code", error: null, sessionTask: null };
    case "begin_provider": return { ...state, step: "provider_pending", provider: event.provider, retryStep: "chooser", error: null, sessionTask: task(event.attempt, "provider") };
    case "begin_code_verification": return { ...state, step: "verifying_code", provider: "email", retryStep: "code", error: null, sessionTask: task(event.attempt, "verify_email_code") };
    case "begin_claim": return { ...state, step: "claiming", retryStep: "claiming", error: null, sessionTask: task(event.attempt, "claim") };
    case "begin_reconcile": return { ...state, step: "reconciling", retryStep: "reconciling", error: null, sessionTask: task(event.attempt, "reconcile") };
    case "resend_rate_limited": return { ...state, step: "error", retryStep: "code", error: event.message, sessionTask: null, resend: { status: "rate_limited", retryAt: event.retryAt } };
    case "code_expired": return { ...state, step: "error", retryStep: "email", error: event.message, sessionTask: null, codeExpired: true };
    case "guest_expired": return { ...state, step: "expired", error: event.message, sessionTask: null, retryStep: "chooser" };
    case "guest_deleted": return { ...state, step: "deleted", error: event.message, sessionTask: null, retryStep: "chooser" };
    case "recoverable_error": return { ...state, step: "error", retryStep: retryStepFor(state), error: event.message, sessionTask: null };
    case "retry": return state.retryStep === "chooser" ? chooser(state) : { ...state, step: state.retryStep, error: null, sessionTask: null };
    case "provider_cancelled": return chooser(state);
    case "use_different_email": return { ...state, step: "email", email: "", provider: "email", retryStep: "email", error: null, codeExpired: false, sessionTask: null };
    // The host hides the modal after this durable transition; local draft state remains intact.
    case "dismissed": return { ...state, sessionTask: null };
  }
}

export function guestSignInBusy(state: GuestSignInSheetState): boolean {
  return state.sessionTask !== null || state.step === "claiming" || state.step === "reconciling";
}

export function guestEmailCanResend(state: GuestSignInSheetState, now: Date): boolean {
  if (state.resend.status === "available") return true;
  return state.resend.retryAt !== null && Date.parse(state.resend.retryAt) <= now.getTime();
}
