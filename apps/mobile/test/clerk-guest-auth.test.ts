import { expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const held = vi.hoisted(() => ({
  session: null as null | { status: "pending" | "active"; currentTask?: { key: string } },
  signedIn: false,
  signInStatus: null as string | null,
  providerCreatedSession: true,
  setActive: null as null | ((args: any) => Promise<void>),
  finalize: null as null | ((args: any) => Promise<{ error: null }>),
}));
vi.mock("@clerk/expo", () => ({
  isClerkAPIResponseError: (error: unknown) => Boolean(error && typeof error === "object" && "errors" in error),
  useAuth: () => ({ isLoaded: true, isSignedIn: held.signedIn, userId: "clerk-A", getToken: async () => "verified" }),
  useSession: () => ({ session: held.session }),
  useClerk: () => ({ session: held.session, signOut: async () => undefined }),
  useSignIn: () => ({ signIn: { status: held.signInStatus, emailCode: { verifyCode: async () => ({ error: null }), sendCode: async () => ({ error: null }) }, finalize: held.finalize } }),
  useSignUp: () => ({ signUp: { create: async () => ({ error: null }), finalize: held.finalize } }),
  useSSO: () => ({ startSSOFlow: async () => ({ createdSessionId: "session-A", setActive: held.setActive }) }),
}));
vi.mock("@clerk/expo/apple", () => ({ useSignInWithApple: () => ({ startAppleAuthenticationFlow: async () => ({ createdSessionId: "session-A", setActive: held.setActive }) }) }));
vi.mock("@clerk/expo/google", () => ({ useSignInWithGoogle: () => ({ startGoogleAuthenticationFlow: async () => ({ createdSessionId: held.providerCreatedSession ? "session-A" : null, setActive: held.setActive,
  signIn: held.signInStatus ? { status: held.signInStatus } : undefined }) }) }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { safeClerkError, useClerkGuestAuth, type ClerkGuestAuth } from "../src/auth/clerk-guest-auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Hook({ onChange }: { onChange(value: ClerkGuestAuth): void }) { onChange(useClerkGuestAuth()); return null; }

it("PROVIDER-08 maps only structured Clerk code, expiry, and rate-limit errors to safe actions", () => {
  const clerk = (code: string) => ({ errors: [{ code, message: "private provider detail" }] });
  expect(safeClerkError(clerk("form_code_incorrect"))).toMatchObject({ guestAuthFailure: "incorrect_code", message: "That code did not match. Check it and try again." });
  expect(safeClerkError(clerk("verification_expired"))).toMatchObject({ guestAuthFailure: "code_expired", message: "That code expired. Request a new one." });
  expect(safeClerkError(clerk("form_code_expired"))).toMatchObject({ guestAuthFailure: "code_expired" });
  expect(safeClerkError(clerk("user_rate_limit_exceeded"))).toMatchObject({ guestAuthFailure: "rate_limited" });
  expect(safeClerkError(clerk("unexpected_secret_failure")).message).toBe("Sign-in could not be completed. Your message is still saved.");
  expect(safeClerkError(new Error("private provider detail")).message).toBe("Sign-in could not be completed. Your message is still saved.");
});

it("PROVIDER-10 provider task stays pending until Clerk emits an active session", async () => {
  held.session = null; held.signedIn = false; held.signInStatus = null; held.providerCreatedSession = true;
  held.setActive = async ({ navigate }) => { await navigate({ session: { status: "pending", currentTask: { key: "setup-mfa" } } }); held.session = { status: "pending", currentTask: { key: "setup-mfa" } }; };
  let auth!: ClerkGuestAuth;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Hook, { onChange: value => { auth = value; } })); });
  let outcome!: string;
  await act(async () => { outcome = await auth.startProvider("google"); });
  expect(outcome).toBe("pending_task");
  expect(auth.sessionTaskPending).toBe(true);
  expect(auth.signedIn).toBe(false);
  expect(await auth.getToken()).toBeNull();
  held.session = { status: "active" }; held.signedIn = true;
  await act(async () => { renderer.update(React.createElement(Hook, { onChange: value => { auth = value; } })); });
  expect(auth.sessionTaskPending).toBe(false);
  expect(auth.signedIn).toBe(true);
  expect(await auth.getToken()).toBe("verified");
  await act(async () => { renderer.unmount(); });
});

it("PROVIDER-10 email finalization reports a pending task without granting a member bearer", async () => {
  held.session = null; held.signedIn = false; held.signInStatus = null; held.providerCreatedSession = true;
  held.finalize = async ({ navigate }) => { await navigate({ session: { status: "pending", currentTask: { key: "reset-password" } } }); return { error: null }; };
  let auth!: ClerkGuestAuth;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Hook, { onChange: value => { auth = value; } })); });
  let outcome!: string;
  await act(async () => { outcome = await auth.verifyEmailCode("123456"); });
  expect(outcome).toBe("pending_task");
  expect(auth.sessionTaskPending).toBe(true);
  expect(auth.signedIn).toBe(false);
  expect(await auth.getToken()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("PROVIDER-10 incomplete social or email MFA moves to native completion without a claimable token", async () => {
  held.session = null; held.signedIn = false; held.signInStatus = "needs_second_factor"; held.providerCreatedSession = false;
  held.finalize = async () => { throw new Error("finalize must wait for MFA"); };
  let auth!: ClerkGuestAuth;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Hook, { onChange: value => { auth = value; } })); });
  let social!: string, email!: string;
  await act(async () => { social = await auth.startProvider("google"); email = await auth.verifyEmailCode("123456"); });
  expect(social).toBe("pending_task");
  expect(email).toBe("pending_task");
  expect(auth.signedIn).toBe(false);
  expect(await auth.getToken()).toBeNull();
  await act(async () => { renderer.unmount(); });
});
