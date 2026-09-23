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
  clerkWebhook?: { signingSecret: string; instanceId: string };
  guestBootstrapEnabled: boolean;
  guestProofPepper?: string;
  guestSponsorPolicyId: string;
  providerCapabilities: { apple: boolean; google: boolean; emailCode: boolean;
    termsUrl?: string; privacyUrl?: string };
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
  /** R12 attachment storage admission. Allowances are 0 in production when unset (fail closed). */
  attachmentAccountByteQuota: number;
  attachmentAccountObjectQuota: number;
  attachmentAdmissionLimit: number;
  attachmentAdmissionWindowMs: number;
  attachmentGlobalByteQuota: number;
  attachmentGlobalObjectQuota: number;
  attachmentReservationTtlMs: number;
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
  let clerkWebhook: AppConfig["clerkWebhook"];
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
    if (!env.CLERK_WEBHOOK_SIGNING_SECRET?.startsWith("whsec_") ||
        !/^ins_[A-Za-z0-9]+$/.test(env.CLERK_WEBHOOK_INSTANCE_ID ?? ""))
      throw new Error("Production Clerk auth requires a pinned webhook signing secret and instance ID");
    clerkWebhook = { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
      instanceId: env.CLERK_WEBHOOK_INSTANCE_ID! };
  }
  const guestBootstrapEnabled = env.NORROW_GUEST_BOOTSTRAP_ENABLED === "true";
  if (guestBootstrapEnabled && (!env.NORROW_GUEST_PROOF_PEPPER || env.NORROW_GUEST_PROOF_PEPPER.length < 32))
    throw new Error("Guest bootstrap requires a strong proof pepper");
  const legalUrl = (value: string | undefined) => {
    if (!value) return undefined;
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error("Legal link must be an HTTPS URL"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
      throw new Error("Legal link must be an HTTPS URL");
    return parsed.href;
  };
  const clerkReady = authMode === "production" && identityProvider === "clerk" && Boolean(clerkAuth);
  const providerCapabilities = {
    apple: clerkReady && env.CLERK_APPLE_PROVIDER_VERIFIED === "true",
    google: clerkReady && env.CLERK_GOOGLE_PROVIDER_VERIFIED === "true",
    emailCode: clerkReady && env.CLERK_EMAIL_CODE_PROVIDER_VERIFIED === "true",
    termsUrl: legalUrl(env.APP_TERMS_URL), privacyUrl: legalUrl(env.APP_PRIVACY_URL),
  };
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    nodeEnv,
    authMode,
    identityProvider,
    supabaseAuth,
    clerkAuth,
    clerkWebhook,
    guestBootstrapEnabled,
    guestProofPepper: env.NORROW_GUEST_PROOF_PEPPER,
    guestSponsorPolicyId: env.NORROW_GUEST_SPONSOR_POLICY_ID ?? "norrow-guest-first.v1",
    providerCapabilities,
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
    attachmentAccountByteQuota: quotaConfig(env, "ATTACHMENT_ACCOUNT_BYTE_QUOTA", 256 * 1024 * 1024, nodeEnv === "production"),
    attachmentAccountObjectQuota: quotaConfig(env, "ATTACHMENT_ACCOUNT_OBJECT_QUOTA", 500, nodeEnv === "production"),
    attachmentAdmissionLimit: quotaConfig(env, "ATTACHMENT_ADMISSION_LIMIT", 60, nodeEnv === "production"),
    attachmentAdmissionWindowMs: integerConfig(env, "ATTACHMENT_ADMISSION_WINDOW_MS", 60_000, 1),
    attachmentGlobalByteQuota: quotaConfig(env, "ATTACHMENT_GLOBAL_BYTE_QUOTA", 8 * 1024 * 1024 * 1024, nodeEnv === "production"),
    attachmentGlobalObjectQuota: quotaConfig(env, "ATTACHMENT_GLOBAL_OBJECT_QUOTA", 50_000, nodeEnv === "production"),
    attachmentReservationTtlMs: integerConfig(env, "ATTACHMENT_RESERVATION_TTL_MS", 15 * 60_000, 1),
  };
}

/**
 * R12 storage allowance. Staging/development get a finite safe default; a
 * production value must be explicit. A missing production allowance becomes 0,
 * which denies every upload rather than starting unlimited.
 */
function quotaConfig(env: NodeJS.ProcessEnv, name: string, stagingDefault: number, production: boolean): number {
  if (env[name] === undefined && production) return 0;
  return integerConfig(env, name, stagingDefault);
}

function integerConfig(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
