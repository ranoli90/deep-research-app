import { z } from "zod";

export type AuthProviderConfig = { url: string; publishableKey: string };
export type VerifiedIdentity = { issuer: string; subject: string };
export type IdentityResult = { status: "verified"; identity: VerifiedIdentity } | { status: "rejected" | "unavailable" };

const User = z.object({
  id: z.string().uuid(), aud: z.literal("authenticated"), role: z.literal("authenticated"),
  is_anonymous: z.boolean().optional(), email_confirmed_at: z.string().datetime({ offset: true }).nullish(),
  phone_confirmed_at: z.string().datetime({ offset: true }).nullish(),
});

/** The configured Auth server verifies signature, expiry and current user/session; client metadata grants nothing. */
export async function verifySupabaseIdentity(token: string, config: AuthProviderConfig,
  transport: typeof fetch = fetch): Promise<IdentityResult> {
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { status: "rejected" };
  try {
    const response = await transport(`${config.url}/auth/v1/user`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { apikey: config.publishableKey, authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) return { status: "rejected" };
    if (!response.ok || !response.body) return { status: "unavailable" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) { await reader.cancel(); return { status: "unavailable" }; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const parsed = User.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return { status: "rejected" };
    const user = parsed.data;
    if (user.is_anonymous || !(user.email_confirmed_at || user.phone_confirmed_at)) return { status: "rejected" };
    return { status: "verified", identity: { issuer: `${config.url}/auth/v1`, subject: user.id } };
  } catch { return { status: "unavailable" }; }
}
