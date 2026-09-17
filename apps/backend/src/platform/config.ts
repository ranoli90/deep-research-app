import { CONSENT_POLICY_VERSION } from "@deep/contracts";

export type AppConfig = {
  nodeEnv: string;
  authMode: "development" | "production";
  supabaseAuth?: { url: string; publishableKey: string };
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
  liveBudgetScope?: string;
  consentPolicyVersion: string;
  writingCancelWindowMs: number;
  /** Live comparison arm. Default adaptive; baseline is the bounded chooser. */
  liveControllerKind: "baseline" | "adaptive";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const authMode = (env.APP_AUTH_MODE ?? "development") as AppConfig["authMode"];
  if (authMode !== "development" && authMode !== "production") throw new Error("Invalid APP_AUTH_MODE");
  const liveRouteEnabled = env.LIVE_ROUTE_ENABLED === "true";
  const fixtureRouteAllowed = env.DEV_ALLOW_FIXTURE_ROUTE !== "false";
  if (nodeEnv === "production" && authMode === "development") {
    throw new Error("APP_AUTH_MODE=development is forbidden in production");
  }
  if (nodeEnv === "production" && fixtureRouteAllowed) {
    throw new Error("Fixture route cannot start in production");
  }
  let supabaseAuth: AppConfig["supabaseAuth"];
  if (authMode === "production") {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")) {
      throw new Error("Production auth requires SUPABASE_URL and a SUPABASE_PUBLISHABLE_KEY");
    }
    let url: URL;
    try { url = new URL(env.SUPABASE_URL); } catch { throw new Error("Invalid SUPABASE_URL"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("SUPABASE_URL must be an HTTPS project origin");
    }
    supabaseAuth = { url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY };
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    nodeEnv,
    authMode,
    supabaseAuth,
    databaseUrl,
    apiHost: env.API_HOST ?? "127.0.0.1",
    apiPort: integerConfig(env, "API_PORT", 8787, 1, 65535),
    workerId: env.WORKER_ID ?? "worker-1",
    leaseMs: integerConfig(env, "LEASE_MS", 30_000, 1),
    storageDir: env.STORAGE_DIR ?? "./data/storage",
    fixtureRouteAllowed,
    liveRouteEnabled,
    liveRetrievalEnabled: env.LIVE_RETRIEVAL_ENABLED === "true",
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    liveSpendCapMicro: integerConfig(env, "LIVE_SPEND_CAP_MICRO", 0),
    liveBudgetScope: env.LIVE_BUDGET_SCOPE ?? "project",
    consentPolicyVersion: env.CONSENT_POLICY_VERSION ?? CONSENT_POLICY_VERSION,
    writingCancelWindowMs: integerConfig(env, "WRITING_CANCEL_WINDOW_MS", 150),
    liveControllerKind: env.LIVE_CONTROLLER_KIND === "baseline" ? "baseline" : "adaptive",
  };
}

function integerConfig(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
