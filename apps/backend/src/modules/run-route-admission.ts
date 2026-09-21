import type pg from "pg";
import type { CreateRunRequest } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import { liveSpendUsedMicro, canIssueLiveCall } from "./live-spend.js";
import { modelPolicy } from "../ports/model-policy.js";

function denied(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, statusCode: 403 });
}

/** Every run entry point, including claim continuation, must re-evaluate current route controls. */
export async function assertRouteAdmission(pool: pg.Pool, config: AppConfig,
  routeMode: CreateRunRequest["routeMode"]) {
  if (routeMode === "fixture") {
    if (!config.fixtureRouteAllowed) denied("permission_denied", "Fixture route is disabled.");
    return;
  }
  if (!config.liveRouteEnabled) denied("permission_denied", "Live route is not enabled.");
  if (config.nodeEnv === "production" && !config.structuredModelEnabled)
    denied("permission_denied", "Structured research is disabled.");
  if (!config.openRouterApiKey || config.liveSpendCapMicro <= 0)
    denied("permission_denied", "Live route requires an authorized key and budget.");
  const used = await liveSpendUsedMicro(pool);
  if (!canIssueLiveCall({ capMicro: config.liveSpendCapMicro, usedMicro: used }).ok)
    denied("allowance_exhausted", "Live spend cap is exhausted.");
}

export function admittedRunOptions(config: AppConfig) {
  return { strategy: config.structuredStrategy, modelPolicyId: config.structuredModelPolicyId,
    zdrRequired: config.structuredModelPolicyId ? modelPolicy(config.structuredModelPolicyId).provider === "azure" : false };
}
