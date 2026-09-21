import { useAuth, useClerk, useSession, useSignIn, useSignUp, useSSO, isClerkAPIResponseError } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

export type ClerkGuestAuth = {
  loaded: boolean;
  signedIn: boolean;
  subject: string | null;
  sessionTaskPending: boolean;
  getToken(options?: { skipCache?: boolean }): Promise<string | null>;
  startProvider(provider: "apple" | "google"): Promise<"active" | "pending_task">;
  sendEmailCode(email: string, resend: boolean): Promise<void>;
  verifyEmailCode(code: string): Promise<"active" | "pending_task">;
  /** Called only after the server confirms the journaled task attempt ended. */
  confirmSessionTaskDismissed(): void;
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

function needsNativeCompletion(status: unknown): boolean {
  return status === "needs_second_factor" || status === "needs_client_trust" || status === "needs_new_password" || status === "needs_protect_check";
}

/** Native Clerk hooks are mounted only inside a configured ClerkProvider. No development session fallback. */
export function useClerkGuestAuth(): ClerkGuestAuth {
  // Pending Clerk sessions can finish an MFA/reset task, but must not receive
  // a member research bearer or claim a guest conversation yet.
  const auth = useAuth({ treatPendingAsSignedOut: false });
  const { session } = useSession();
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const { startSSOFlow } = useSSO();

  const [taskReported, setTaskReported] = useState(false);
  useEffect(() => { if (session?.status === "active") setTaskReported(false); }, [session?.status]);
  const sessionTaskPending = taskReported || session?.status === "pending";
  const active = auth.isLoaded && auth.isSignedIn && session?.status === "active" && !sessionTaskPending;

  return {
    loaded: auth.isLoaded,
    signedIn: !!active,
    subject: active ? auth.userId : null,
    sessionTaskPending,
    getToken: async options => active ? auth.getToken(options) : null,
    startProvider: async provider => {
      try {
        let pendingTask = false;
        const result = provider === "google" ? await startGoogleAuthenticationFlow()
          : Platform.OS === "ios" ? await startAppleAuthenticationFlow()
            : await startSSOFlow({ strategy: "oauth_apple" });
        if (!result.createdSessionId || !result.setActive) {
          if (needsNativeCompletion(result.signIn?.status) || result.signUp?.status === "missing_requirements") {
            setTaskReported(true);
            return "pending_task";
          }
          throw new Error("Sign-in was cancelled.");
        }
        await result.setActive({ session: result.createdSessionId, navigate: ({ session: next }) => {
          if (next?.currentTask) { pendingTask = true; setTaskReported(true); }
        } });
        return pendingTask || clerk.session?.status === "pending" ? "pending_task" : "active";
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
        let pendingTask = false;
        const reportTask = ({ session: next }: { session: { currentTask?: unknown } | null }) => {
          if (next?.currentTask) { pendingTask = true; setTaskReported(true); }
        };
        const result = await signIn.emailCode.verifyCode({ code });
        if (result.error) {
          if (isClerkAPIResponseError(result.error) && result.error.errors[0]?.code === "sign_up_if_missing_transfer") {
            const transfer = await signUp.create({ transfer: true });
            if (transfer.error) throw transfer.error;
            // Core3 mutation methods return {error} and may update the hook on
            // another render. Finalize itself is the authoritative completion
            // gate; an incomplete security task remains blocked by Clerk.
            const finalized = await signUp.finalize({ navigate: reportTask });
            if (finalized.error) throw finalized.error;
            return pendingTask || clerk.session?.status === "pending" ? "pending_task" : "active";
          }
          throw result.error;
        }
        if (needsNativeCompletion(signIn.status)) { setTaskReported(true); return "pending_task"; }
        const finalized = await signIn.finalize({ navigate: reportTask });
        if (finalized.error) throw finalized.error;
        return pendingTask || clerk.session?.status === "pending" ? "pending_task" : "active";
      } catch (error) { throw safeClerkError(error); }
    },
    confirmSessionTaskDismissed: () => { setTaskReported(false); },
    signOut: async () => { await clerk.signOut(); },
  };
}
