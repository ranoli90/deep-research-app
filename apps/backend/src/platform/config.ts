import { CONSENT_POLICY_VERSION } from "@deep/contracts";

export type AppConfig = {
  nodeEnv: string;
  authMode: "development" | "production";
  databaseUrl: string;
  apiHost: string;
  apiPort: number;
  workerId: string;
  leaseMs: number;
  storageDir: string;
  fixtureRouteAllowed: boolean;
  liveRouteEnabled: boolean;
  liveRetrievalEnabled: boolean;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  liveSpendCapMicro: number;
  consentPolicyVersion: string;
  writingCancelWindowMs: number;
  /** Live comparison arm. Default adaptive; baseline is the bounded chooser. */
  liveControllerKind: "baseline" | "adaptive";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const authMode = (env.APP_AUTH_MODE ?? "development") as AppConfig["authMode"];
  const liveRouteEnabled = env.LIVE_ROUTE_ENABLED === "true";
  const fixtureRouteAllowed = env.DEV_ALLOW_FIXTURE_ROUTE !== "false";
  if (nodeEnv === "production" && authMode === "development") {
    throw new Error("APP_AUTH_MODE=development is forbidden in production");
  }
  if (nodeEnv === "production" && fixtureRouteAllowed && env.ALLOW_FIXTURE_IN_PRODUCTION !== "true") {
    throw new Error("Fixture route cannot start in production without explicit ALLOW_FIXTURE_IN_PRODUCTION");
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    nodeEnv,
    authMode,
    databaseUrl,
    apiHost: env.API_HOST ?? "127.0.0.1",
    apiPort: Number(env.API_PORT ?? 8787),
    workerId: env.WORKER_ID ?? "worker-1",
    leaseMs: Number(env.LEASE_MS ?? 30_000),
    storageDir: env.STORAGE_DIR ?? "./data/storage",
    fixtureRouteAllowed,
    liveRouteEnabled,
    liveRetrievalEnabled: env.LIVE_RETRIEVAL_ENABLED === "true",
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    liveSpendCapMicro: Number(env.LIVE_SPEND_CAP_MICRO ?? 0),
    consentPolicyVersion: env.CONSENT_POLICY_VERSION ?? CONSENT_POLICY_VERSION,
    writingCancelWindowMs: Number(env.WRITING_CANCEL_WINDOW_MS ?? 150),
    liveControllerKind: env.LIVE_CONTROLLER_KIND === "baseline" ? "baseline" : "adaptive",
  };
}
