import { describe, expect, it } from "vitest";
import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
  FIXTURE_TARIFF_VERSION,
  LIVE_CALL_RESERVE_MICRO,
} from "@deep/contracts";
import { loadConfig } from "../src/platform/config.js";
import { pinRouteCapabilities } from "../src/modules/route-capabilities.js";

function cfg(extra: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: "postgres://deep:deep@127.0.0.1:55432/deep_research_test",
    LIVE_ROUTE_ENABLED: "false",
    DEV_ALLOW_FIXTURE_ROUTE: "true",
    ...extra,
  });
}

describe("G06 route capability pin", () => {
  it("pins fixture tariffs without a live provider call", () => {
    const caps = pinRouteCapabilities(cfg());
    const search = caps.find((c) => c.routeId === "fixture" && c.capability === "search");
    const fetch = caps.find((c) => c.routeId === "fixture" && c.capability === "fetch");
    const synth = caps.find((c) => c.routeId === "fixture" && c.capability === "synthesize");
    expect(search?.status).toBe("supported");
    expect(search?.tariffMicro).toBe(FIXTURE_SEARCH_COST_MICRO);
    expect(fetch?.tariffMicro).toBe(FIXTURE_FETCH_COST_MICRO);
    expect(synth?.tariffMicro).toBe(FIXTURE_SYNTH_COST_MICRO);
    expect(search?.tariffVersion).toBe(FIXTURE_TARIFF_VERSION);
    expect(search?.effectiveProcessor).toBe("app-owned-fixture-catalog");
    expect(caps.find((c) => c.capability === "internal_search_visibility")?.status).toBe("unsupported");
    expect(caps.find((c) => c.routeId === "hosted-baseline")?.status).toBe("unsupported");
    expect(caps.find((c) => c.routeId === "controlled-research" && c.capability === "search")?.status).toBe("unsupported");
    expect(caps.every((c) => !/live completion issued/i.test(c.evidence) || c.routeId === "controlled-research")).toBe(true);
  });

  it("pins live route as supported only when key and cap exist, still without issuing a completion", () => {
    const caps = pinRouteCapabilities(
      cfg({ LIVE_ROUTE_ENABLED: "true", OPENROUTER_API_KEY: "sk-test-not-used", LIVE_SPEND_CAP_MICRO: "5000000" }),
    );
    const live = caps.find((c) => c.routeId === "controlled-research" && c.capability === "search");
    expect(live?.status).toBe("supported");
    expect(live?.tariffMicro).toBe(LIVE_CALL_RESERVE_MICRO);
    expect(live?.effectiveProcessor).toMatch(/^openrouter:/);
    expect(live?.evidence).toMatch(/no live completion issued/i);
    expect(caps.find((c) => c.routeId === "controlled-research" && c.capability === "internal_search_visibility")?.status).toBe(
      "unsupported",
    );
  });
});
