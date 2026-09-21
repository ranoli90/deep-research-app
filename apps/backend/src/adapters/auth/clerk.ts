import { verifyToken } from "@clerk/backend";
import type { AppConfig } from "../../platform/config.js";

export type VerifiedCustomerIdentity = {
  issuer: string;
  subject: string;
  sessionId: string;
  tokenClass: "customer_session";
  issuedAt: number;
  expiresAt: number;
};
export type ClerkIdentityResult =
  | { status: "verified"; identity: VerifiedCustomerIdentity }
  | { status: "rejected" | "unavailable" };

function remoteUnavailable(error: unknown): boolean {
  const reason = (error as { reason?: string }).reason;
  return !reason || ["jwk-remote-failed-to-load", "jwk-failed-to-resolve"].includes(reason);
}

/** Clerk SDK verifies signature/time; local checks pin issuer, optional party,
 * customer-session class, and active session state (pending sessions denied). */
export async function verifyClerkIdentity(token: string, config: NonNullable<AppConfig["clerkAuth"]>): Promise<ClerkIdentityResult> {
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return { status: "rejected" };
  let claims;
  try {
    claims = await verifyToken(token, {
      ...(config.jwtKey ? { jwtKey: config.jwtKey } : { secretKey: config.secretKey }),
      ...(config.audience ? { audience: config.audience } : {}),
      clockSkewInMs: 5000,
      headerType: "JWT",
    });
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (config.jwtKey && config.secretKey &&
        ["jwk-kid-mismatch", "jwk-local-missing", "token-invalid-signature"].includes(reason ?? "")) {
      try {
        claims = await verifyToken(token, { secretKey: config.secretKey,
          ...(config.audience ? { audience: config.audience } : {}),
          clockSkewInMs: 5000, headerType: "JWT" });
      } catch (refreshError) {
        return remoteUnavailable(refreshError) ? { status: "unavailable" } : { status: "rejected" };
      }
    } else {
      return remoteUnavailable(error) ? { status: "unavailable" } : { status: "rejected" };
    }
  }
  const issuer = (claims as { iss?: unknown }).iss;
  const subject = (claims as { sub?: unknown }).sub;
  const sessionId = (claims as { sid?: unknown }).sid;
  const issuedAt = (claims as { iat?: unknown }).iat;
  const expiresAt = (claims as { exp?: unknown }).exp;
  const party = (claims as { azp?: unknown }).azp;
  if (issuer !== config.issuer || typeof subject !== "string" || !/^user_[A-Za-z0-9]+$/.test(subject) ||
      typeof sessionId !== "string" || !/^sess_[A-Za-z0-9]+$/.test(sessionId) ||
      !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
      (party !== undefined && (typeof party !== "string" || !config.authorizedParties.includes(party))))
    return { status: "rejected" };
  // A pending (or otherwise non-active) session bearer must never satisfy
  // ordinary member access. Absent status claims mean an active session and
  // still pass; any present session-state marker must read exactly "active".
  // Checked after signature/issuer/party/expiry so those controls keep firing
  // first, and before the caller maps an account, so a pending bearer creates
  // no identity row.
  const sessionStates = [(claims as { sts?: unknown }).sts, (claims as { status?: unknown }).status,
    (claims as { session_status?: unknown }).session_status, (claims as { sessionStatus?: unknown }).sessionStatus];
  if (sessionStates.some((state) => state !== undefined && state !== "active"))
    return { status: "rejected" };
  return { status: "verified", identity: { issuer, subject, sessionId,
    tokenClass: "customer_session", issuedAt: issuedAt as number, expiresAt: expiresAt as number } };
}
