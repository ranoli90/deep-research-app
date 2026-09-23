import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config.js";

describe("M12 demo/production separation", () => {
  it.each(["NaN", "Infinity", "-1", "1.5", "9007199254740992", " "])("W02 rejects invalid live cap %s", (value) => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: value })).toThrow(/LIVE_SPEND_CAP_MICRO/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_KEY_SPEND_CAP_MICRO: value })).toThrow(/LIVE_KEY_SPEND_CAP_MICRO/);
  });
  it("W02 never permits fixture routing in production through an override", () => {
    expect(() => loadConfig({ NODE_ENV: "production", APP_AUTH_MODE: "production", DATABASE_URL: "postgres://localhost/test",
      DEV_ALLOW_FIXTURE_ROUTE: "true", ALLOW_FIXTURE_IN_PRODUCTION: "true" })).toThrow(/Fixture route/);
  });
  it("refuses development auth and unlabeled fixtures in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        APP_AUTH_MODE: "development",
        DATABASE_URL: "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research",
      }),
    ).toThrow(/development is forbidden in production/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        APP_AUTH_MODE: "production",
        DEV_ALLOW_FIXTURE_ROUTE: "true",
        DATABASE_URL: "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research",
      }),
    ).toThrow(/Fixture route cannot start in production/);
  });
  it("NARROW-AUTH production Clerk requires an exact signed webhook namespace", () => {    const env = { NODE_ENV: "production", APP_AUTH_MODE: "production", APP_IDENTITY_PROVIDER: "clerk",
      DEV_ALLOW_FIXTURE_ROUTE: "false", DATABASE_URL: "postgres://localhost/test",
      CLERK_ISSUER: "https://clerk.example.test", CLERK_AUTHORIZED_PARTIES: "https://app.example.test",
      CLERK_PUBLISHABLE_KEY: "pk_test_only", CLERK_SECRET_KEY: "sk_test_only" };
    expect(() => loadConfig(env)).toThrow(/pinned webhook/);
    expect(() => loadConfig({ ...env, CLERK_WEBHOOK_SIGNING_SECRET: "whsec_testonly" })).toThrow(/pinned webhook/);
    const configured = loadConfig({ ...env, CLERK_WEBHOOK_SIGNING_SECRET: "whsec_testonly",
      CLERK_WEBHOOK_INSTANCE_ID: "ins_testonly" });
    expect(configured.clerkWebhook).toEqual({ signingSecret: "whsec_testonly", instanceId: "ins_testonly" });
    expect(configured.providerCapabilities).toMatchObject({ apple: false, google: false, emailCode: false });
  });
});

describe("R12 attachment storage allowances", () => {
  const productionEnv = {
    NODE_ENV: "production", APP_AUTH_MODE: "production", DEV_ALLOW_FIXTURE_ROUTE: "false",
    DATABASE_URL: "postgres://localhost/test", SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
  };
  it("staging defaults are finite and positive", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/test" });
    expect(config.attachmentAccountByteQuota).toBeGreaterThan(0);
    expect(config.attachmentAccountObjectQuota).toBeGreaterThan(0);
    expect(config.attachmentAdmissionLimit).toBeGreaterThan(0);
    expect(config.attachmentGlobalByteQuota).toBeGreaterThan(0);
    expect(config.attachmentGlobalObjectQuota).toBeGreaterThan(0);
    expect(config.attachmentAdmissionWindowMs).toBeGreaterThan(0);
    expect(config.attachmentReservationTtlMs).toBeGreaterThan(0);
  });
  it("production fails closed to zero when an allowance is unset and accepts explicit values", () => {
    const missing = loadConfig(productionEnv);
    expect(missing.attachmentAccountByteQuota).toBe(0);
    expect(missing.attachmentAccountObjectQuota).toBe(0);
    expect(missing.attachmentAdmissionLimit).toBe(0);
    expect(missing.attachmentGlobalByteQuota).toBe(0);
    expect(missing.attachmentGlobalObjectQuota).toBe(0);
    const explicit = loadConfig({ ...productionEnv, ATTACHMENT_ACCOUNT_BYTE_QUOTA: "1024",
      ATTACHMENT_ACCOUNT_OBJECT_QUOTA: "5", ATTACHMENT_ADMISSION_LIMIT: "7",
      ATTACHMENT_GLOBAL_BYTE_QUOTA: "4096", ATTACHMENT_GLOBAL_OBJECT_QUOTA: "9" });
    expect(explicit).toMatchObject({ attachmentAccountByteQuota: 1024, attachmentAccountObjectQuota: 5,
      attachmentAdmissionLimit: 7, attachmentGlobalByteQuota: 4096, attachmentGlobalObjectQuota: 9 });
  });
  it("rejects a malformed allowance instead of defaulting", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/test", ATTACHMENT_ACCOUNT_BYTE_QUOTA: "-1" }))
      .toThrow(/ATTACHMENT_ACCOUNT_BYTE_QUOTA/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/test", ATTACHMENT_GLOBAL_BYTE_QUOTA: "1.5" }))
      .toThrow(/ATTACHMENT_GLOBAL_BYTE_QUOTA/);
  });
});
