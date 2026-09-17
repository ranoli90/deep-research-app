import { createHash } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ResearchModelOutputs, RESEARCH_MODEL_SCHEMA_VERSION, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
import { ModelContextSchema, type PreparedModelRequest, type ModelResult, type ModelReceipt } from "../../ports/model.js";
import { costToMicro } from "./usage.js";
import { MODEL_PROMPT_VERSION, modelPrompt } from "./prompts.js";
import { STRUCTURED_MODEL_POLICY as policy } from "./policy.js";

const Envelope = z.object({
  id: z.string().max(300).optional(), model: z.string().max(300), provider: z.string().max(300).optional(),
  usage: z.object({ cost: z.union([z.string().max(100), z.number()]).optional(),
    prompt_tokens: z.number().int().nonnegative().safe().optional(), completion_tokens: z.number().int().nonnegative().safe().optional(),
  }).optional(),
  choices: z.array(z.object({ finish_reason: z.string().max(100).nullable(),
    message: z.object({ content: z.string().max(800_000).nullable().optional(), refusal: z.string().max(4000).nullable().optional() }),
  })).min(1).max(1),
});

/** Canonical schemas generate the provider contract; local validation remains mandatory. */
export function prepareModelRequest<K extends ResearchModelOperation>(operation: K, context: unknown): PreparedModelRequest<K> {
  const contextText = JSON.stringify(ModelContextSchema.parse(context));
  if (!contextText || Buffer.byteLength(contextText) > 240_000) throw new Error("model_context_too_large");
  const schema = zodToJsonSchema(ResearchModelOutputs[operation], { $refStrategy: "none" });
  const body = JSON.stringify({
    model: policy.model, max_tokens: policy.outputTokens, temperature: 0, stream: false, plugins: [],
    provider: { only: [policy.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny",
      max_price: { prompt: policy.promptMicroPerMillion / 1_000_000, completion: policy.completionMicroPerMillion / 1_000_000, request: 0 } },
    response_format: { type: "json_schema", json_schema: { name: `research_${operation}_v1`, strict: true, schema } },
    messages: [{ role: "system", content: modelPrompt(operation) }, { role: "user", content: contextText }],
  });
  if (Buffer.byteLength(body) > policy.contextTokens) throw new Error("model_context_exceeds_policy");
  return { operation, body, digest: createHash("sha256").update(body).digest("hex"),
    schemaVersion: RESEARCH_MODEL_SCHEMA_VERSION, promptVersion: MODEL_PROMPT_VERSION, policyId: policy.id };
}

/** Transport only. The worker must durably reserve the attempt before invoking this function. No retries/fallbacks. */
export async function executeModelRequest<K extends ResearchModelOperation>(request: PreparedModelRequest<K>, args: {
  apiKey: string; signal: AbortSignal; deadlineMs?: number;
}): Promise<ModelResult<K>> {
  const receipt: ModelReceipt = { requestedModel: policy.model, reportedModel: null, reportedProvider: null,
    providerId: null, httpStatus: null, startedAt: new Date().toISOString(), finishedAt: "", actualMicro: null,
    promptTokens: null, completionTokens: null, rawCost: null, responseDigest: null };
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
      if (response.body) void response.body.cancel().catch(() => undefined);
      return fail(response.status === 429 || response.status >= 500 ? "transient_failure" : "permanent_failure", `provider_http_${response.status}`);
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
    if (data.model !== policy.model || (data.provider && data.provider !== policy.providerName)) return fail("permanent_failure", "provider_route_mismatch");
    const parsed = Envelope.safeParse(value);
    if (!parsed.success) return fail("invalid_output", "invalid_provider_envelope");
    const choice = parsed.data.choices[0]!;
    if (choice.message.refusal || choice.finish_reason === "content_filter") return fail("refused", "model_refusal");
    if (choice.finish_reason !== "stop") return fail("invalid_output", "incomplete_model_output");
    let output: unknown;
    try { output = JSON.parse(choice.message.content ?? ""); } catch { return fail("invalid_output", "invalid_output_json"); }
    const checked = ResearchModelOutputs[request.operation].safeParse(output);
    if (!checked.success) return fail("invalid_output", "output_schema_mismatch");
    return finish({ status: "succeeded", output: checked.data as ResearchModelOutput<K>, receipt });
  } catch { return fail("outcome_unknown", "provider_transport_outcome_unknown"); }
  finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (reader) void reader.cancel().catch(() => undefined);
  }
}
