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
