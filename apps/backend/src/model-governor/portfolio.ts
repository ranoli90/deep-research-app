import {
  AZURE_ZDR_EXACT_QUOTE_POLICY,
  AZURE_ZDR_MODEL_POLICY,
  STRUCTURED_MODEL_POLICY,
  modelPolicy,
  type ModelPolicyId,
} from "../ports/model-policy.js";

export const RESEARCH_PORTFOLIO_ID = "research-portfolio.v1";
export const MAX_ESCALATION_DEPTH = 2;
export const MAX_DEFAULT_FANOUT = 1;

export type ModelTier = 0 | 1 | 2 | 3 | 4;
export type OperationClass = "exploration" | "verification" | "writing" | "structured";

export type RouteCapabilities = {
  policyId: string;
  model: string;
  provider: string;
  providerName: string;
  tier: ModelTier;
  structuredOutput: boolean;
  zdr: boolean;
  dataCollection: "deny" | "allow";
  promptMicroPerMillion: number;
  completionMicroPerMillion: number;
  cacheSticky: boolean;
  available: boolean;
};

export type PrivacyRequirement = {
  zdrRequired: boolean;
  dataCollection: "deny" | "allow";
};

/** Admission metadata for registered policies. Request bytes stay in prepareModelRequest. */
export const REGISTERED_ROUTE_CAPABILITIES: Record<ModelPolicyId, RouteCapabilities> = {
  [STRUCTURED_MODEL_POLICY.id]: {
    policyId: STRUCTURED_MODEL_POLICY.id,
    model: STRUCTURED_MODEL_POLICY.model,
    provider: STRUCTURED_MODEL_POLICY.provider,
    providerName: STRUCTURED_MODEL_POLICY.providerName,
    tier: 1,
    structuredOutput: true,
    zdr: false,
    dataCollection: "deny",
    promptMicroPerMillion: STRUCTURED_MODEL_POLICY.promptMicroPerMillion,
    completionMicroPerMillion: STRUCTURED_MODEL_POLICY.completionMicroPerMillion,
    cacheSticky: true,
    available: true,
  },
  [AZURE_ZDR_MODEL_POLICY.id]: {
    policyId: AZURE_ZDR_MODEL_POLICY.id,
    model: AZURE_ZDR_MODEL_POLICY.model,
    provider: AZURE_ZDR_MODEL_POLICY.provider,
    providerName: AZURE_ZDR_MODEL_POLICY.providerName,
    tier: 1,
    structuredOutput: true,
    zdr: true,
    dataCollection: "deny",
    promptMicroPerMillion: AZURE_ZDR_MODEL_POLICY.promptMicroPerMillion,
    completionMicroPerMillion: AZURE_ZDR_MODEL_POLICY.completionMicroPerMillion,
    cacheSticky: true,
    available: true,
  },
  [AZURE_ZDR_EXACT_QUOTE_POLICY.id]: {
    policyId: AZURE_ZDR_EXACT_QUOTE_POLICY.id,
    model: AZURE_ZDR_EXACT_QUOTE_POLICY.model,
    provider: AZURE_ZDR_EXACT_QUOTE_POLICY.provider,
    providerName: AZURE_ZDR_EXACT_QUOTE_POLICY.providerName,
    tier: 1,
    structuredOutput: true,
    zdr: true,
    dataCollection: "deny",
    promptMicroPerMillion: AZURE_ZDR_EXACT_QUOTE_POLICY.promptMicroPerMillion,
    completionMicroPerMillion: AZURE_ZDR_EXACT_QUOTE_POLICY.completionMicroPerMillion,
    cacheSticky: true,
    available: true,
  },
};

export type PortfolioCatalog = {
  id: string;
  defaultStrategy: "cheap-first";
  maxEscalationDepth: number;
  maxFanout: number;
  candidates: RouteCapabilities[];
};

export const PRODUCTION_PORTFOLIO_V1: PortfolioCatalog = {
  id: RESEARCH_PORTFOLIO_ID,
  defaultStrategy: "cheap-first",
  maxEscalationDepth: MAX_ESCALATION_DEPTH,
  maxFanout: MAX_DEFAULT_FANOUT,
  candidates: [
    REGISTERED_ROUTE_CAPABILITIES[STRUCTURED_MODEL_POLICY.id],
    REGISTERED_ROUTE_CAPABILITIES[AZURE_ZDR_MODEL_POLICY.id],
    REGISTERED_ROUTE_CAPABILITIES[AZURE_ZDR_EXACT_QUOTE_POLICY.id],
  ],
};

export function capabilitiesFor(policyId: string): RouteCapabilities {
  const registered = (REGISTERED_ROUTE_CAPABILITIES as Record<string, RouteCapabilities | undefined>)[policyId];
  if (registered) return registered;
  const policy = modelPolicy(policyId);
  return {
    policyId: policy.id,
    model: policy.model,
    provider: policy.provider,
    providerName: policy.providerName,
    tier: 1,
    structuredOutput: true,
    zdr: policy.provider === "azure",
    dataCollection: "deny",
    promptMicroPerMillion: policy.promptMicroPerMillion,
    completionMicroPerMillion: policy.completionMicroPerMillion,
    cacheSticky: false,
    available: true,
  };
}

export function replayPolicyIdentity(policyId: string) {
  const policy = modelPolicy(policyId);
  return { id: policy.id, model: policy.model, provider: policy.provider, providerName: policy.providerName };
}
