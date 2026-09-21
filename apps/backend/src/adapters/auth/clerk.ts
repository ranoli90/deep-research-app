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

/** Clerk SDK verifies signature/time/party. Local checks pin environment and customer-session class. */
export async function verifyClerkIdentity(token: string, config: NonNullable<AppConfig["clerkAuth"]>): Promise<ClerkIdentityResult> {
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return { status: "rejected" };
  let claims;
  try {
    claims = await verifyToken(token, {
      ...(config.jwtKey ? { jwtKey: config.jwtKey } : { secretKey: config.secretKey }),
      authorizedParties: config.authorizedParties,
      ...(config.audience ? { audience: config.audience } : {}),
      clockSkewInMs: 5000,
      headerType: "JWT",
    });
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (config.jwtKey && config.secretKey && ["jwk-kid-mismatch", "jwk-local-missing"].includes(reason ?? "")) {
      try {
        claims = await verifyToken(token, { secretKey: config.secretKey,
          authorizedParties: config.authorizedParties,
          ...(config.audience ? { audience: config.audience } : {}),
          clockSkewInMs: 5000, headerType: "JWT" });
      } catch (refreshError) {
        return ["jwk-remote-failed-to-load", "jwk-failed-to-resolve"].includes((refreshError as { reason?: string }).reason ?? "")
          ? { status: "unavailable" } : { status: "rejected" };
      }
    } else {
      return ["jwk-remote-failed-to-load", "jwk-failed-to-resolve"].includes(reason ?? "")
        ? { status: "unavailable" } : { status: "rejected" };
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
      typeof party !== "string" || !config.authorizedParties.includes(party)) return { status: "rejected" };
  return { status: "verified", identity: { issuer, subject, sessionId,
    tokenClass: "customer_session", issuedAt: issuedAt as number, expiresAt: expiresAt as number } };
}
