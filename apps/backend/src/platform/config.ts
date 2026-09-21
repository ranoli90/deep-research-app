import {strictPolicyForNewAdmission,type ModelPolicyId} from "../ports/model-policy.js";
import { researchStrategy, type ResearchStrategy } from "../ports/research-strategy.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";

export type AppConfig = {
  nodeEnv: string;
  authMode: "development" | "production";
  identityProvider: "supabase" | "clerk";
  supabaseAuth?: { url: string; publishableKey: string };
  clerkAuth?: { issuer: string; publishableKey: string; secretKey?: string; jwtKey?: string;
    authorizedParties: string[]; audience?: string };
  guestBootstrapEnabled: boolean;
  guestProofPepper?: string;
  guestSponsorPolicyId: string;
  databaseUrl: string;
  apiHost: string;
  apiPort: number;
  workerId: string;
  leaseMs: number;
  storageDir: string;
  fixtureRouteAllowed: boolean;
  liveRouteEnabled: boolean;
  structuredModelEnabled?: boolean;
  structuredModelPolicyId?: ModelPolicyId;
  structuredStrategy?: ResearchStrategy;
  structuredDiscoveryEnabled?: boolean;
  structuredChallengeEnabled?: boolean;
  liveRetrievalEnabled: boolean;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  liveSpendCapMicro: number;
  liveBudgetScope?: string;
  liveKeySpendCapMicro?: number;
  consentPolicyVersion: string;
  writingCancelWindowMs: number;
  /** Historical diagnostic chooser only; production uses persisted structuredStrategy. */
  liveControllerKind: "baseline" | "adaptive";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const authMode = (env.APP_AUTH_MODE ?? "development") as AppConfig["authMode"];
  if (authMode !== "development" && authMode !== "production") throw new Error("Invalid APP_AUTH_MODE");
  const identityProvider = (env.APP_IDENTITY_PROVIDER ?? "supabase") as AppConfig["identityProvider"];
  if (identityProvider !== "supabase" && identityProvider !== "clerk") throw new Error("Invalid APP_IDENTITY_PROVIDER");
  const liveRouteEnabled = env.LIVE_ROUTE_ENABLED === "true";
  const fixtureRouteAllowed = env.DEV_ALLOW_FIXTURE_ROUTE !== "false";
  if (nodeEnv === "production" && authMode === "development") {
    throw new Error("APP_AUTH_MODE=development is forbidden in production");
  }
  if (nodeEnv === "production" && fixtureRouteAllowed) {
    throw new Error("Fixture route cannot start in production");
  }
  let supabaseAuth: AppConfig["supabaseAuth"];
  if (authMode === "production" && identityProvider === "supabase") {
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
  let clerkAuth: AppConfig["clerkAuth"];
  if (authMode === "production" && identityProvider === "clerk") {
    let issuer: URL;
    try { issuer = new URL(env.CLERK_ISSUER ?? ""); } catch { throw new Error("CLERK_ISSUER must be an HTTPS origin"); }
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/")
      throw new Error("CLERK_ISSUER must be an HTTPS origin");
    const parties = (env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    if (!parties.length || parties.some((part) => {
      try { const origin = new URL(part); return origin.origin !== part || !["https:", ...(nodeEnv === "production" ? [] : ["http:"])].includes(origin.protocol); }
      catch { return true; }
    })) throw new Error("CLERK_AUTHORIZED_PARTIES must contain exact allowed origins");
    if (!env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_") || !env.CLERK_SECRET_KEY?.startsWith("sk_"))
      throw new Error("Production Clerk auth requires a publishable key and secret for trusted key rotation");
    clerkAuth = { issuer: issuer.origin, publishableKey: env.CLERK_PUBLISHABLE_KEY,
      secretKey: env.CLERK_SECRET_KEY, jwtKey: env.CLERK_JWT_KEY, authorizedParties: parties,
      audience: env.CLERK_AUDIENCE || undefined };
  }
  const guestBootstrapEnabled = env.NORROW_GUEST_BOOTSTRAP_ENABLED === "true";
  if (guestBootstrapEnabled && (!env.NORROW_GUEST_PROOF_PEPPER || env.NORROW_GUEST_PROOF_PEPPER.length < 32))
    throw new Error("Guest bootstrap requires a strong proof pepper");
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    nodeEnv,
    authMode,
    identityProvider,
    supabaseAuth,
    clerkAuth,
    guestBootstrapEnabled,
    guestProofPepper: env.NORROW_GUEST_PROOF_PEPPER,
    guestSponsorPolicyId: env.NORROW_GUEST_SPONSOR_POLICY_ID ?? "norrow-guest-first.v1",
    databaseUrl,
    apiHost: env.API_HOST ?? "127.0.0.1",
    apiPort: integerConfig(env, "API_PORT", 8787, 1, 65535),
    workerId: env.WORKER_ID ?? "worker-1",
    leaseMs: integerConfig(env, "LEASE_MS", 30_000, 1),
    storageDir: env.STORAGE_DIR ?? "./data/storage",
    fixtureRouteAllowed,
    liveRouteEnabled,
    structuredModelEnabled: env.STRUCTURED_MODEL_ENABLED === "true",
    structuredModelPolicyId: strictPolicyForNewAdmission(env.STRUCTURED_MODEL_POLICY_ID),
    structuredStrategy: researchStrategy(env.STRUCTURED_RESEARCH_STRATEGY),
    structuredDiscoveryEnabled: env.STRUCTURED_DISCOVERY_ENABLED === "true",
    structuredChallengeEnabled: env.STRUCTURED_CHALLENGE_ENABLED === "true",
    liveRetrievalEnabled: env.LIVE_RETRIEVAL_ENABLED === "true",
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    liveSpendCapMicro: integerConfig(env, "LIVE_SPEND_CAP_MICRO", 0),
    liveBudgetScope: env.LIVE_BUDGET_SCOPE ?? "project",
    liveKeySpendCapMicro: integerConfig(env, "LIVE_KEY_SPEND_CAP_MICRO", 0),
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
