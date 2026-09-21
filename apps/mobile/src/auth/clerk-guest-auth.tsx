import { useAuth, useClerk, useSignIn, useSignUp, useSSO, isClerkAPIResponseError } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { Platform } from "react-native";

export type ClerkGuestAuth = {
  loaded: boolean;
  signedIn: boolean;
  subject: string | null;
  getToken(options?: { skipCache?: boolean }): Promise<string | null>;
  startProvider(provider: "apple" | "google"): Promise<void>;
  sendEmailCode(email: string, resend: boolean): Promise<void>;
  verifyEmailCode(code: string): Promise<void>;
  signOut(): Promise<void>;
};

export type ClerkGuestAuthFailureKind = "incorrect_code" | "code_expired" | "rate_limited";
class ClerkGuestAuthFailure extends Error {
  constructor(message: string, readonly guestAuthFailure: ClerkGuestAuthFailureKind) { super(message); }
}

export function safeClerkError(error: unknown): Error {
  if (error instanceof Error && error.message === "Complete the account security step before continuing research.") return error;
  const providerCode = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  if (["SIGN_IN_CANCELLED", "ERR_REQUEST_CANCELED", "-5"].includes(providerCode ?? "")) return new Error("Sign-in was cancelled.");
  if (isClerkAPIResponseError(error)) {
    const code = error.errors[0]?.code;
    if (code === "form_code_incorrect") return new ClerkGuestAuthFailure("That code did not match. Check it and try again.", "incorrect_code");
    if (code === "verification_expired" || code === "form_code_expired") return new ClerkGuestAuthFailure("That code expired. Request a new one.", "code_expired");
    if (code?.includes("rate_limit") || code === "too_many_requests") return new ClerkGuestAuthFailure("Too many attempts. Wait before trying again.", "rate_limited");
  }
  return new Error("Sign-in could not be completed. Your message is still saved.");
}

/** Native Clerk hooks are mounted only inside a configured ClerkProvider. No development session fallback. */
export function useClerkGuestAuth(): ClerkGuestAuth {
  const auth = useAuth();
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const { startSSOFlow } = useSSO();

  const noPendingTask = ({ session }: { session: { currentTask?: unknown } | null }) => {
    if (session?.currentTask) throw new Error("Complete the account security step before continuing research.");
  };

  return {
    loaded: auth.isLoaded,
    signedIn: auth.isLoaded && auth.isSignedIn,
    subject: auth.isLoaded && auth.isSignedIn ? auth.userId : null,
    getToken: async options => auth.isLoaded && auth.isSignedIn ? auth.getToken(options) : null,
    startProvider: async provider => {
      try {
        const result = provider === "google" ? await startGoogleAuthenticationFlow()
          : Platform.OS === "ios" ? await startAppleAuthenticationFlow()
            : await startSSOFlow({ strategy: "oauth_apple" });
        if (!result.createdSessionId || !result.setActive) {
          if (result.signIn?.status || result.signUp?.status) throw new Error("Complete the account security step before continuing research.");
          throw new Error("Sign-in was cancelled.");
        }
        await result.setActive({ session: result.createdSessionId });
      } catch (error) {
        if (error instanceof Error && error.message === "Sign-in was cancelled.") throw error;
        throw safeClerkError(error);
      }
    },
    sendEmailCode: async (email, resend) => {
      try {
        if (!signIn) throw new Error("Sign-in is unavailable.");
        if (!resend) {
          const result = await signIn.create({ identifier: email, signUpIfMissing: true });
          if (result.error) throw result.error;
        }
        const sent = await signIn.emailCode.sendCode();
        if (sent.error) throw sent.error;
      } catch (error) { throw safeClerkError(error); }
    },
    verifyEmailCode: async code => {
      try {
        if (!signIn || !signUp) throw new Error("Sign-in is unavailable.");
        const result = await signIn.emailCode.verifyCode({ code });
        if (result.error) {
          if (isClerkAPIResponseError(result.error) && result.error.errors[0]?.code === "sign_up_if_missing_transfer") {
            const transfer = await signUp.create({ transfer: true });
            if (transfer.error) throw transfer.error;
            // Core3 mutation methods return {error} and may update the hook on
            // another render. Finalize itself is the authoritative completion
            // gate; an incomplete security task remains blocked by Clerk.
            const finalized = await signUp.finalize({ navigate: noPendingTask });
            if (finalized.error) throw finalized.error;
            return;
          }
          throw result.error;
        }
        const finalized = await signIn.finalize({ navigate: noPendingTask });
        if (finalized.error) throw finalized.error;
      } catch (error) { throw safeClerkError(error); }
    },
    signOut: async () => { await clerk.signOut(); },
  };
}
