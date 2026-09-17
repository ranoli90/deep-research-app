import {
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
  FIXTURE_TARIFF_VERSION,
  LIVE_CALL_RESERVE_MICRO,
} from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";

export type RouteCapability = {
  routeId: string;
  capability: "search" | "fetch" | "synthesize" | "cancel" | "internal_search_visibility";
  status: "supported" | "unsupported" | "unknown";
  checkedAt: string;
  effectiveProcessor: string | null;
  tariffMicro: number | null;
  tariffVersion: string | null;
  evidence: string;
};

function liveReady(config: AppConfig): boolean {
  return Boolean(config.liveRouteEnabled && config.openRouterApiKey && config.liveSpendCapMicro > 0);
}

/** Config/tariff pin only. Does not issue a provider completion or other paid call. */
export function pinRouteCapabilities(config: AppConfig, now = new Date()): RouteCapability[] {
  const checkedAt = now.toISOString();
  const live = liveReady(config);
  const liveProcessor = live ? `openrouter:${config.openRouterModel}` : null;
  return [
    {
      routeId: "fixture",
      capability: "search",
      status: "supported",
      checkedAt,
      effectiveProcessor: "app-owned-fixture-catalog",
      tariffMicro: FIXTURE_SEARCH_COST_MICRO,
      tariffVersion: FIXTURE_TARIFF_VERSION,
      evidence: "deterministic fixture catalog; no provider call",
    },
    {
      routeId: "fixture",
      capability: "fetch",
      status: "supported",
      checkedAt,
      effectiveProcessor: "app-owned-fixture-catalog",
      tariffMicro: FIXTURE_FETCH_COST_MICRO,
      tariffVersion: FIXTURE_TARIFF_VERSION,
      evidence: "deterministic fixture catalog; no provider call",
    },
    {
      routeId: "fixture",
      capability: "synthesize",
      status: "supported",
      checkedAt,
      effectiveProcessor: "app-owned-fixture-catalog",
      tariffMicro: FIXTURE_SYNTH_COST_MICRO,
      tariffVersion: FIXTURE_TARIFF_VERSION,
      evidence: "deterministic fixture compose; no provider call",
    },
    {
      routeId: "fixture",
      capability: "cancel",
      status: "supported",
      checkedAt,
      effectiveProcessor: "app-owned-research-worker",
      tariffMicro: 0,
      tariffVersion: FIXTURE_TARIFF_VERSION,
      evidence: "app-owned cancel fence; in-flight fixture actions may still settle",
    },
    {
      routeId: "fixture",
      capability: "internal_search_visibility",
      status: "unsupported",
      checkedAt,
      effectiveProcessor: null,
      tariffMicro: null,
      tariffVersion: null,
      evidence: "the app does not observe provider-internal searches",
    },
    {
      routeId: "controlled-research",
      capability: "search",
      status: live ? "supported" : "unsupported",
      checkedAt,
      effectiveProcessor: liveProcessor,
      tariffMicro: live ? LIVE_CALL_RESERVE_MICRO : null,
      tariffVersion: live ? "openrouter-reserve-bound" : null,
      evidence: live
        ? "config pin only; reservation bound is not a measured OpenRouter invoice; no live completion issued for this probe"
        : "live route disabled or missing OPENROUTER_API_KEY/LIVE_SPEND_CAP_MICRO",
    },
    {
      routeId: "controlled-research",
      capability: "internal_search_visibility",
      status: "unsupported",
      checkedAt,
      effectiveProcessor: liveProcessor,
      tariffMicro: null,
      tariffVersion: null,
      evidence: "OpenRouter web-plugin internal searches are not visible to this app",
    },
    {
      routeId: "hosted-baseline",
      capability: "search",
      status: "unsupported",
      checkedAt,
      effectiveProcessor: null,
      tariffMicro: null,
      tariffVersion: null,
      evidence: "hosted-baseline is not an implemented launch route",
    },
  ];
}
