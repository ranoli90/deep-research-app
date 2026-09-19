import type { ResearchModelOperation } from "@deep/contracts";
import { isStrictModelPolicy, modelPolicy } from "../../ports/model-policy.js";

/** Conservative token estimate. Never compare raw bytes to a token-count field. */
export function estimateTokens(text: string): number {
  const bytes = Buffer.byteLength(text, "utf8");
  return Math.max(1, Math.ceil(bytes / 3));
}

export const MODEL_CONTEXT_OVERHEAD_TOKENS = 1024;

export type OperationBudget = {
  maxInputTokens: number;
  maxOutputTokens: number;
  deadlineMs: number;
};

export function operationBudget(operation: ResearchModelOperation, policyId: string): OperationBudget {
  const policy = modelPolicy(policyId);
  if (operation === "write_report" || operation === "write_calculated_report") {
    return { maxInputTokens: Math.min(policy.contextTokens - Math.min(policy.outputTokens * 2, 8192) - MODEL_CONTEXT_OVERHEAD_TOKENS, 96_000), maxOutputTokens: Math.min(policy.outputTokens * 2, 8192), deadlineMs: 120_000 };
  }
  if (operation === "review_coverage" || operation === "review_calculated_coverage" || operation === "assess_support") {
    return { maxInputTokens: Math.min(policy.contextTokens - policy.outputTokens - MODEL_CONTEXT_OVERHEAD_TOKENS, 64_000), maxOutputTokens: policy.outputTokens, deadlineMs: 90_000 };
  }
  if (operation === "extract_assertions") {
    return { maxInputTokens: Math.min(policy.contextTokens - policy.outputTokens - MODEL_CONTEXT_OVERHEAD_TOKENS, 64_000), maxOutputTokens: policy.outputTokens, deadlineMs: 90_000 };
  }
  return { maxInputTokens: Math.min(policy.contextTokens - policy.outputTokens - MODEL_CONTEXT_OVERHEAD_TOKENS, 48_000), maxOutputTokens: policy.outputTokens, deadlineMs: 45_000 };
}

export function admitContextTokens(args: { contextText: string; bodyText: string; operation: ResearchModelOperation; policyId: string }): void {
  const policy = modelPolicy(args.policyId);
  const budget = operationBudget(args.operation, args.policyId);
  const contextTokens = estimateTokens(args.contextText);
  // Strict v4 uses a UTF-8 byte upper bound, independent of language/tokenizer guesses.
  const bodyTokens = isStrictModelPolicy(policy.id) ? Buffer.byteLength(args.bodyText, "utf8") : estimateTokens(args.bodyText);
  if (contextTokens > budget.maxInputTokens) throw new Error("model_context_too_large");
  if (bodyTokens + budget.maxOutputTokens + MODEL_CONTEXT_OVERHEAD_TOKENS > policy.contextTokens) throw new Error("model_context_exceeds_policy");
}

export function reserveMicroForOperation(args: { operation: ResearchModelOperation; policyId: string; bodyText: string }): number {
  const policy = modelPolicy(args.policyId);
  const budget = operationBudget(args.operation, args.policyId);
  // UTF-8 byte count bounds text tokens even for adversarial/non-English input.
  // Reserve the full admitted context if the byte bound exceeds its window.
  const input = Math.min(Buffer.byteLength(args.bodyText, "utf8") + MODEL_CONTEXT_OVERHEAD_TOKENS, policy.contextTokens - budget.maxOutputTokens);
  const planned = Math.ceil(
    (input * policy.promptMicroPerMillion + budget.maxOutputTokens * policy.completionMicroPerMillion) / 1_000_000,
  );
  const withMargin = Math.ceil(planned * 1.25) + 1;
  return Math.max(withMargin, 1);
}

export function routeStringFor(policyId: string, operation: string): string {
  const policy = modelPolicy(policyId);
  return `openrouter:${policy.model}:${policy.id}:${operation}`;
}
