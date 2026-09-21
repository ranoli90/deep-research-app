import { expect, it, vi } from "vitest";

vi.mock("@clerk/expo", () => ({ isClerkAPIResponseError: (error: unknown) => Boolean(error && typeof error === "object" && "errors" in error) }));
vi.mock("@clerk/expo/apple", () => ({}));
vi.mock("@clerk/expo/google", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { safeClerkError } from "../src/auth/clerk-guest-auth";

it("PROVIDER-08 maps only structured Clerk code, expiry, and rate-limit errors to safe actions", () => {
  const clerk = (code: string) => ({ errors: [{ code, message: "private provider detail" }] });
  expect(safeClerkError(clerk("form_code_incorrect"))).toMatchObject({ guestAuthFailure: "incorrect_code", message: "That code did not match. Check it and try again." });
  expect(safeClerkError(clerk("verification_expired"))).toMatchObject({ guestAuthFailure: "code_expired", message: "That code expired. Request a new one." });
  expect(safeClerkError(clerk("form_code_expired"))).toMatchObject({ guestAuthFailure: "code_expired" });
  expect(safeClerkError(clerk("user_rate_limit_exceeded"))).toMatchObject({ guestAuthFailure: "rate_limited" });
  expect(safeClerkError(clerk("unexpected_secret_failure")).message).toBe("Sign-in could not be completed. Your message is still saved.");
  expect(safeClerkError(new Error("private provider detail")).message).toBe("Sign-in could not be completed. Your message is still saved.");
});
