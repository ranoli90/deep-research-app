import { CALCULATION_PLANNING_PROMPT_VERSION, CALCULATED_REPORT_PROMPT_VERSION } from "../../ports/model-policy.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ResearchModelOutputs, CALCULATED_REPORT_SCHEMA_VERSION, CALCULATION_PLANNING_SCHEMA_VERSION, RESEARCH_MODEL_SCHEMA_VERSION, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
import { ModelContextSchema, ModelDiagnosticFieldSchema, type PreparedModelRequest, type ModelResult, type ModelReceipt } from "../../ports/model.js";
import { costToMicro } from "./usage.js";
import { MODEL_PROMPT_VERSION, modelPrompt } from "./prompts.js";
import { modelPolicy,STRUCTURED_MODEL_POLICY } from "../../ports/model-policy.js";

const Envelope = z.object({
  id: z.string().max(300).optional(), model: z.string().max(300), provider: z.string().max(300).optional(),
  usage: z.object({ cost: z.union([z.string().max(100), z.number()]).optional(),
    prompt_tokens: z.number().int().nonnegative().safe().optional(), completion_tokens: z.number().int().nonnegative().safe().optional(),
    cache_read_tokens: z.number().int().nonnegative().safe().optional(),
    cache_write_tokens: z.number().int().nonnegative().safe().optional(),
    prompt_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().safe().optional(),
      cache_write_tokens: z.number().int().nonnegative().safe().optional(),
    }).optional(),
  }).optional(),
  choices: z.array(z.object({ finish_reason: z.string().max(100).nullable(),
    message: z.object({ content: z.string().max(800_000).nullable().optional(), refusal: z.string().max(4000).nullable().optional() }),
  })).min(1).max(1),
});

/** Canonical schemas generate the provider contract; local validation remains mandatory.
 * Optional extras (session stickiness) must not be passed for historical policy replay. */
export function prepareModelRequest<K extends ResearchModelOperation>(operation: K, context: unknown, policyId: string = STRUCTURED_MODEL_POLICY.id, extras?: { sessionId?: string }): PreparedModelRequest<K> {
  const policy=modelPolicy(policyId);
  const contextText = JSON.stringify(ModelContextSchema.parse(context));
  if (!contextText || Buffer.byteLength(contextText) > 240_000) throw new Error("model_context_too_large");
  const schema = zodToJsonSchema(ResearchModelOutputs[operation], { $refStrategy: "none" });
  const body = JSON.stringify({
    model: policy.model, [policy.provider === "azure" ? "max_completion_tokens" : "max_tokens"]: policy.outputTokens, temperature: 0, stream: false, plugins: [],
    provider: { only: [policy.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", ...(policy.provider === "azure" ? {zdr:true} : {}),
      max_price: { prompt: policy.promptMicroPerMillion / 1_000_000, completion: policy.completionMicroPerMillion / 1_000_000, request: 0 } },
    response_format: { type: "json_schema", json_schema: { name: `research_${operation}_v1`, strict: true, schema } },
    messages: [{ role: "system", content: modelPrompt(operation) }, { role: "user", content: contextText }],
    ...(extras?.sessionId ? { session_id: extras.sessionId } : {}),
  });
  if (Buffer.byteLength(body) > policy.contextTokens) throw new Error("model_context_exceeds_policy");
  return { operation, body, digest: createHash("sha256").update(body).digest("hex"),
    schemaVersion: ["write_calculated_report","review_calculated_coverage"].includes(operation)?CALCULATED_REPORT_SCHEMA_VERSION:operation==="plan_calculations"?CALCULATION_PLANNING_SCHEMA_VERSION:RESEARCH_MODEL_SCHEMA_VERSION,
    promptVersion: ["write_calculated_report","review_calculated_coverage"].includes(operation)?CALCULATED_REPORT_PROMPT_VERSION:operation==="plan_calculations"?CALCULATION_PLANNING_PROMPT_VERSION:MODEL_PROMPT_VERSION, policyId: policy.id };
}

/** Transport only. The worker must durably reserve the attempt before invoking this function. No retries/fallbacks. */
export async function executeModelRequest<K extends ResearchModelOperation>(request: PreparedModelRequest<K>, args: {
  apiKey: string; signal: AbortSignal; deadlineMs?: number;
}): Promise<ModelResult<K>> {
  const policy=modelPolicy(request.policyId);
  const receipt: ModelReceipt = { requestedModel: policy.model, reportedModel: null, reportedProvider: null,
    providerId: null, httpStatus: null, startedAt: new Date().toISOString(), finishedAt: "", actualMicro: null,
    promptTokens: null, completionTokens: null, rawCost: null, responseDigest: null,
    cacheReadTokens: null, cacheWriteTokens: null };
  const finish = <T extends ModelResult<K>>(value: T): T => { value.receipt.finishedAt = new Date().toISOString(); return value; };
  const fail = (status: Exclude<ModelResult<K>["status"], "succeeded">, reason: string): ModelResult<K> => finish({ status, reason, receipt });
  const timeout = args.deadlineMs ?? 45_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 45_000) return fail("permanent_failure", "invalid_model_deadline");
  if (!args.apiKey.trim() || args.signal.aborted) return fail("refused", "credential_missing_or_cancelled");
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(timeout)]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("model_request_aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const response = await Promise.race([fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${args.apiKey.trim()}`, "Content-Type": "application/json" },
      body: request.body, redirect: "error", signal,
    }), aborted]);
    receipt.httpStatus = response.status;
    if (!response.ok) {
      // Keep only a fixed diagnostic category and digest, never upstream prose.
      let category = "";
      if (response.body) {
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let bytes = 0;
        while (true) {
          const part = await Promise.race([reader.read(), aborted]);
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 65536) break;
          chunks.push(part.value);
        }
        if (bytes <= 65536) {
          const raw = Buffer.concat(chunks);
          receipt.responseDigest = createHash("sha256").update(raw).digest("hex");
          try {
            const parsed = JSON.parse(raw.toString("utf8"));
            const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "";
            if (response.status === 404 && /^(?:No endpoints (?:found|available)\b|0 endpoints out of \d+ requested are available\b)/i.test(message)) {
              category = /data policy|privacy|training|guardrail|ZDR/i.test(message) ? "_data_policy" :
                /price|pricing/i.test(message) ? "_price" :
                /parameter|structured|json|tool use/i.test(message) ? "_parameters" : "_no_endpoints";
            }
          } catch { /* Unparseable error remains a generic HTTP failure with unknown cost. */ }
        }
      }
      return fail(response.status === 429 || response.status >= 500 ? "transient_failure" : "permanent_failure", `provider_http_${response.status}${category}`);
    }
    if (!response.body) return fail("invalid_output", "empty_response_body");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) return fail("invalid_output", "provider_response_too_large");
      chunks.push(part.value);
    }
    const raw = Buffer.concat(chunks);
    receipt.responseDigest = createHash("sha256").update(raw).digest("hex");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { return fail("invalid_output", "invalid_response_json"); }
    const metadata = Envelope.omit({ choices: true }).safeParse(value);
    if (!metadata.success) return fail("invalid_output", "invalid_provider_envelope");
    const data = metadata.data;
    receipt.providerId = data.id ?? null; receipt.reportedModel = data.model; receipt.reportedProvider = data.provider ?? null;
    receipt.actualMicro = costToMicro(data.usage?.cost) ?? null;
    receipt.rawCost = receipt.actualMicro == null ? null : String(data.usage!.cost);
    receipt.promptTokens = data.usage?.prompt_tokens ?? null; receipt.completionTokens = data.usage?.completion_tokens ?? null;
    receipt.cacheReadTokens = data.usage?.cache_read_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens ?? null;
    receipt.cacheWriteTokens = data.usage?.cache_write_tokens ?? data.usage?.prompt_tokens_details?.cache_write_tokens ?? null;
    if (data.model !== policy.model || (data.provider && data.provider !== policy.providerName)) return fail("permanent_failure", "provider_route_mismatch");
    const parsed = Envelope.safeParse(value);
    if (!parsed.success) return fail("invalid_output", "invalid_provider_envelope");
    const choice = parsed.data.choices[0]!;
    if (choice.message.refusal || choice.finish_reason === "content_filter") return fail("refused", "model_refusal");
    if (choice.finish_reason !== "stop") return fail("invalid_output", "incomplete_model_output");
    let output: unknown;
    try { output = JSON.parse(choice.message.content ?? ""); } catch { return fail("invalid_output", "invalid_output_json"); }
    const checked = ResearchModelOutputs[request.operation].safeParse(output);
    if (!checked.success) return finish({ status: "invalid_output", reason: "output_schema_mismatch", receipt,
      diagnostics: { version: "model-validation-diagnostics.v1", stage: "output_schema",
        issues: checked.error.issues.slice(0,16).map(issue => ({ code: issue.code,
          path: issue.path.slice(0,12).map(part => {
            if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && part <= 1_000_000) return part;
            const field = ModelDiagnosticFieldSchema.safeParse(part);
            return field.success ? field.data : "other";
          }),
        })), truncated: checked.error.issues.length > 16 || checked.error.issues.some(issue => issue.path.length > 12),
      } });
    return finish({ status: "succeeded", output: checked.data as ResearchModelOutput<K>, receipt });
  } catch { return fail("outcome_unknown", "provider_transport_outcome_unknown"); }
  finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (reader) void reader.cancel().catch(() => undefined);
  }
}
