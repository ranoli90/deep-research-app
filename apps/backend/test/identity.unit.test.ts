import { describe, expect, it, vi } from "vitest";
import { verifySupabaseIdentity } from "../src/adapters/auth/supabase.js";
import { loadConfig } from "../src/platform/config.js";

const config = { url: "https://test-project.supabase.co", publishableKey: "sb_publishable_test_only" };
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
  is_anonymous: false, email_confirmed_at: "2026-09-01T00:00:00Z", user_metadata: { accountId: "forged-owner", admin: true } };
const token = "test.header.signature"; // Transport-boundary double; never a claim of real provider JWT validation.

describe("W03 configured Supabase verification boundary", () => {
  it("uses only the configured Auth endpoint and verified subject; editable metadata grants no owner/role", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(user));
    expect(await verifySupabaseIdentity(token, config, transport)).toEqual({ status: "verified",
      identity: { issuer: `${config.url}/auth/v1`, subject: user.id } });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe(`${config.url}/auth/v1/user`);
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ apikey: config.publishableKey, authorization: `Bearer ${token}` });
  });
  it.each(["dev_local-token", "not.a.token.extra", "x".repeat(8193)])("rejects malformed/local credentials before network", async (value) => {
    const transport = vi.fn<typeof fetch>();
    expect(await verifySupabaseIdentity(value, config, transport)).toEqual({ status: "rejected" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([{ ...user, role: "service_role" }, { ...user, aud: "other-project" }, { ...user, is_anonymous: true },
    { ...user, id: "not-a-subject" }, { ...user, email_confirmed_at: null }, { ...user, email_confirmed_at: "invalid" }])
  ("rejects unconfirmed, anonymous or non-user responses", async (value) => {
    expect(await verifySupabaseIdentity(token, config, async () => Response.json(value))).toEqual({ status: "rejected" });
  });
  it.each([401, 403])("preserves provider rejection %s", async (status) => {
    expect(await verifySupabaseIdentity(token, config, async () => new Response(null, { status }))).toEqual({ status: "rejected" });
  });
  it("fails closed on outage, malformed or oversized bodies without treating an outage as signed out", async () => {
    for (const transport of [async () => new Response(null, { status: 503 }), async () => new Response("not json"),
      async () => Response.json({ ...user, user_metadata: "x".repeat(70_000) }), async () => { throw new Error("private transport details"); }]) {
      expect(await verifySupabaseIdentity(token, config, transport)).toEqual({ status: "unavailable" });
    }
  });
  it("production startup requires a project origin and publishable key, never secret/service keys", () => {
    const env = { NODE_ENV: "production", APP_AUTH_MODE: "production", DEV_ALLOW_FIXTURE_ROUTE: "false", DATABASE_URL: "postgres://localhost/test" };
    expect(() => loadConfig(env)).toThrow(/Production auth requires/);
    expect(() => loadConfig({ ...env, SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_allowed" })).toThrow(/publishable|PUBLISHABLE/);
    for (const url of ["http://test-project.supabase.co", "https://user:pass@test-project.supabase.co", `${config.url}/path`, `${config.url}?token=x`]) {
      expect(() => loadConfig({ ...env, SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey })).toThrow(/HTTPS project origin/);
    }
    expect(loadConfig({ ...env, SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey }).supabaseAuth).toEqual(config);
  });
});
