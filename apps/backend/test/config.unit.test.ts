import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config.js";

describe("M12 demo/production separation", () => {
  it.each(["NaN", "Infinity", "-1", "1.5", "9007199254740992", " "])("W02 rejects invalid live cap %s", (value) => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_SPEND_CAP_MICRO: value })).toThrow(/LIVE_SPEND_CAP_MICRO/);
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
});
