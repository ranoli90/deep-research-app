export const CALCULATED_REPORT_PROMPT_VERSION="calculated-report-prompt.v1";
export const CALCULATION_PLANNING_PROMPT_VERSION="calculation-planning-prompt.v1";
export const MODEL_PROMPT_VERSION = "research-operations.v1";
/** Versioned, text-only route. Metadata observation is not paid authorization or a live quality probe. */
export const STRUCTURED_MODEL_POLICY = {
  id: "openrouter-openai-mini-text-v1",
  model: "openai/gpt-4o-mini",
  provider: "openai",
  providerName: "OpenAI",
  contextTokens: 128_000,
  outputTokens: 4096,
  promptMicroPerMillion: 150_000,
  completionMicroPerMillion: 600_000,
  observedAt: "2026-09-17",
} as const;
// Reserve the entire advertised context at the price ceiling, not a guessed tokenizer count.
// No paid search/tool/image/audio plugins are enabled by this policy.
export const STRUCTURED_CALL_RESERVE_MICRO = Math.ceil(
  (STRUCTURED_MODEL_POLICY.contextTokens * STRUCTURED_MODEL_POLICY.promptMicroPerMillion +
   STRUCTURED_MODEL_POLICY.outputTokens * STRUCTURED_MODEL_POLICY.completionMicroPerMillion) / 1_000_000,
);

export const AZURE_ZDR_MODEL_POLICY = {
  ...STRUCTURED_MODEL_POLICY,
  id: "openrouter-azure-mini-zdr-text-v1",
  provider: "azure",
  providerName: "Azure",
  observedAt: "2026-09-18",
} as const;
export const AZURE_ZDR_EXACT_QUOTE_POLICY = { ...AZURE_ZDR_MODEL_POLICY, id: "openrouter-azure-mini-zdr-exact-quote-v2" } as const;
export const AZURE_ZDR_DISCOVERY_POLICY = { ...AZURE_ZDR_EXACT_QUOTE_POLICY, id: "openrouter-azure-mini-zdr-discovery-v3" } as const;
export const STRUCTURED_STRICT_POLICY = { ...STRUCTURED_MODEL_POLICY, id: "openrouter-openai-mini-strict-v4" } as const;
export const AZURE_ZDR_STRICT_POLICY = { ...AZURE_ZDR_DISCOVERY_POLICY, id: "openrouter-azure-mini-zdr-strict-v4" } as const;
export function isStrictModelPolicy(id: string): boolean { return id === STRUCTURED_STRICT_POLICY.id || id === AZURE_ZDR_STRICT_POLICY.id; }
export type ModelPolicyId = typeof STRUCTURED_MODEL_POLICY.id | typeof AZURE_ZDR_MODEL_POLICY.id | typeof AZURE_ZDR_EXACT_QUOTE_POLICY.id | typeof AZURE_ZDR_DISCOVERY_POLICY.id | typeof STRUCTURED_STRICT_POLICY.id | typeof AZURE_ZDR_STRICT_POLICY.id;
export function modelPolicy(id:unknown = STRUCTURED_MODEL_POLICY.id) {
  if (id === STRUCTURED_STRICT_POLICY.id) return STRUCTURED_STRICT_POLICY;
  if (id === AZURE_ZDR_STRICT_POLICY.id) return AZURE_ZDR_STRICT_POLICY;
  if (id === STRUCTURED_MODEL_POLICY.id) return STRUCTURED_MODEL_POLICY;
  if (id === AZURE_ZDR_MODEL_POLICY.id) return AZURE_ZDR_MODEL_POLICY;
  if (id === AZURE_ZDR_EXACT_QUOTE_POLICY.id) return AZURE_ZDR_EXACT_QUOTE_POLICY;
  if (id === AZURE_ZDR_DISCOVERY_POLICY.id) return AZURE_ZDR_DISCOVERY_POLICY;
  throw new Error("unsupported_model_policy");
}

/** Production configuration advances new admissions only; run policy/replay never calls this. */
export function strictPolicyForNewAdmission(id?: string): ModelPolicyId {
 const policy=modelPolicy(id ?? STRUCTURED_STRICT_POLICY.id);
 return policy.provider === "azure" ? AZURE_ZDR_STRICT_POLICY.id : STRUCTURED_STRICT_POLICY.id;
}
