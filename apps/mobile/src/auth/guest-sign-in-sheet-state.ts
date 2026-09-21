/**
 * Presentation state for the guest second-send sign-in sheet.
 *
 * This deliberately does not talk to Clerk, persistence, or the pending-action
 * journal. The owning application seam receives every event and only moves this
 * state after it has durably recorded the corresponding auth/claim operation.
 */
export type GuestSignInProvider = "apple" | "google" | "email";

export type GuestProviderAvailability = {
  available: boolean;
  /** User-facing setup failure. An unavailable provider can never start auth. */
  unavailableReason?: string;
};

export type GuestSignInSheetStep =
  | "chooser"
  | "email"
  | "sending_code"
  | "code"
  | "provider_pending"
  | "verifying_code"
  | "claiming"
  | "error";

export type GuestSignInSheetState = {
  step: GuestSignInSheetStep;
  email: string;
  error: string | null;
  /** Where a recoverable failure can safely return. Never an auth outcome. */
  retryStep: "chooser" | "email" | "code" | "claiming";
  /** The active provider is informational only; it is never an auth result. */
  provider: GuestSignInProvider | null;
};

export type GuestSignInSheetEvent =
  | { type: "choose_provider"; provider: GuestSignInProvider }
  | { type: "enter_email" }
  | { type: "edit_email"; email: string }
  | { type: "begin_email_code" }
  | { type: "email_code_sent"; email: string }
  | { type: "enter_code" }
  | { type: "begin_provider"; provider: "apple" | "google" }
  | { type: "begin_code_verification" }
  | { type: "begin_claim" }
  | { type: "recoverable_error"; message: string }
  | { type: "retry" }
  | { type: "provider_cancelled" }
  | { type: "use_different_email" };

export const initialGuestSignInSheetState = (): GuestSignInSheetState => ({
  step: "chooser",
  email: "",
  error: null,
  retryStep: "chooser",
  provider: null,
});

function chooser(state: GuestSignInSheetState, error: string | null = null): GuestSignInSheetState {
  return { ...state, step: "chooser", provider: null, retryStep: "chooser", error };
}

function retryStepFor(state: GuestSignInSheetState): GuestSignInSheetState["retryStep"] {
  if (state.step === "sending_code" || state.step === "email") return "email";
  if (state.step === "code" || state.step === "verifying_code") return "code";
  if (state.step === "claiming") return "claiming";
  return "chooser";
}

/**
 * Strict presentation transitions. Transport outcomes are expressed by the
 * host using begin_* then either recoverable_error, provider_cancelled, or
 * begin_claim; the sheet does not manufacture an authenticated state.
 */
export function reduceGuestSignInSheet(
  state: GuestSignInSheetState,
  event: GuestSignInSheetEvent,
  providers: Record<GuestSignInProvider, GuestProviderAvailability>,
): GuestSignInSheetState {
  switch (event.type) {
    case "choose_provider": {
      const availability = providers[event.provider];
      if (!availability?.available) {
        return chooser(state, availability?.unavailableReason ?? "This sign-in option is not available yet.");
      }
      return event.provider === "email"
        ? { ...state, step: "email", provider: "email", retryStep: "email", error: null }
        : { ...state, step: "provider_pending", provider: event.provider, retryStep: "chooser", error: null };
    }
    case "enter_email":
      return { ...state, step: "email", provider: "email", retryStep: "email", error: null };
    case "edit_email":
      return { ...state, email: event.email, error: null };
    case "begin_email_code":
      return { ...state, step: "sending_code", provider: "email", retryStep: "email", error: null };
    case "email_code_sent":
      return { ...state, step: "code", provider: "email", email: event.email, retryStep: "code", error: null };
    case "enter_code":
      return { ...state, step: "code", provider: "email", retryStep: "code", error: null };
    case "begin_provider":
      return { ...state, step: "provider_pending", provider: event.provider, retryStep: "chooser", error: null };
    case "begin_code_verification":
      return { ...state, step: "verifying_code", provider: "email", retryStep: "code", error: null };
    case "begin_claim":
      return { ...state, step: "claiming", retryStep: "claiming", error: null };
    case "recoverable_error":
      return { ...state, step: "error", retryStep: retryStepFor(state), error: event.message };
    case "retry":
      return state.retryStep === "chooser"
        ? chooser(state)
        : { ...state, step: state.retryStep, error: null };
    case "provider_cancelled":
      return chooser(state);
    case "use_different_email":
      return { ...state, step: "email", email: "", provider: "email", retryStep: "email", error: null };
  }
}

export function guestSignInBusy(state: GuestSignInSheetState): boolean {
  return state.step === "provider_pending" || state.step === "sending_code" || state.step === "verifying_code" || state.step === "claiming";
}
