import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config.js";

describe("M12 demo/production separation", () => {
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
