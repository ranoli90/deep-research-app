import { afterEach, describe, expect, it, vi } from "vitest";
import { executeModelRequest, prepareModelRequest } from "../src/adapters/model/openrouter.js";
import { STRUCTURED_CALL_RESERVE_MICRO } from "../src/adapters/model/policy.js";
import { ModelValidationDiagnosticsSchema } from "../src/ports/model.js";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const context = { question: "Explain coral bleaching", task: null, passages: [], sources: [], assertions: [], approvedClaimKeys: [], draft: null };
const request = () => prepareModelRequest("review_coverage", context);
const response = (content = '{"questions":[],"omittedRequirements":[]}', extra = {}) => ({ id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.0000011", prompt_tokens: 20, completion_tokens: 10 }, choices: [{ finish_reason: "stop", message: { content } }], ...extra });
async function call(value: unknown) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })) as typeof fetch;
  return executeModelRequest(request(), { apiKey: "test-not-billed", signal: new AbortController().signal });
}
describe("W05 structured model transport without fallback", () => {
  it("pins the provider, derives strict schema, disables paid tools and bounds the full-context reserve", async () => {
    const r = request(); const body = JSON.parse(r.body);
    expect(body.provider).toMatchObject({ only: ["openai"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", max_price: { prompt: 0.15, completion: 0.6, request: 0 } });
    expect(body.plugins).toEqual([]);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(STRUCTURED_CALL_RESERVE_MICRO).toBe(21_658);
    const result = await call(response());
    expect(result).toMatchObject({ status: "succeeded", output: { questions: [], omittedRequirements: [] }, receipt: { actualMicro: 2, reportedModel: "openai/gpt-4o-mini", reportedProvider: "OpenAI" } });
    expect(JSON.stringify(result)).not.toContain("test-not-billed");
  });
  it("rejects authority in context before dispatch", () => {
    expect(() => prepareModelRequest("brief", { ...context, accountId: "forged", budgetMicro: 1_000_000 })).toThrow();
  });
  it.each(["not json", '```json\n{"questions":[],"omittedRequirements":[]}\n```', '{"questions":[],"omittedRequirements":[],"verified":true}'])("invalid output never becomes a fixture or successful stop: %s", async (text) => {
    expect(await call(response(text))).toMatchObject({ status: "invalid_output", receipt: { actualMicro: 2 } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves cost on refusal, truncation and malformed output envelopes", async () => {
    expect(await call(response("", { choices: [{ finish_reason: "stop", message: { refusal: "cannot comply" } }] }))).toMatchObject({ status: "refused", receipt: { actualMicro: 2 } });
    expect(await call(response("{}", { choices: [{ finish_reason: "length", message: { content: "{}" } }] }))).toMatchObject({ status: "invalid_output", reason: "incomplete_model_output" });
    expect(await call(response("{}", { choices: [] }))).toMatchObject({ status: "invalid_output", receipt: { actualMicro: 2 } });
  });
  it("does not treat missing cost as a confirmed reservation amount", async () => {
    expect(await call(response(undefined, { usage: {} }))).toMatchObject({ status: "succeeded", receipt: { actualMicro: null, rawCost: null } });
  });
  it("records bounded schema coordinates without rejected values, messages, or unknown keys", async () => {
    const secret = "private-source-token-do-not-retain";
    const result = await call(response(JSON.stringify({questions:[{questionKey:"q1",status:secret,assertionKeys:[],reason:"test",[secret]:secret}],omittedRequirements:[]})));
    expect(result).toMatchObject({status:"invalid_output",reason:"output_schema_mismatch",receipt:{actualMicro:2},
      diagnostics:{version:"model-validation-diagnostics.v1",stage:"output_schema",truncated:false,
        issues:[{code:"invalid_enum_value",path:["questions",0,"status"]},{code:"unrecognized_keys",path:["questions",0]}]}});
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).not.toHaveProperty("output");
    if(result.status!=="succeeded")expect(ModelValidationDiagnosticsSchema.safeParse(result.diagnostics).success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("caps stored schema issues while preserving an explicit truncation marker", async () => {
    const result = await call(response(JSON.stringify({questions:Array.from({length:24},()=>({})),omittedRequirements:[]})));
    expect(result).toMatchObject({status:"invalid_output",reason:"output_schema_mismatch",diagnostics:{truncated:true}});
    if(result.status!=="succeeded")expect(result.diagnostics?.issues).toHaveLength(16);
  });
  it("rejects arbitrary diagnostic fields and leaves successful output free of diagnostics", async () => {
    expect(ModelValidationDiagnosticsSchema.safeParse({version:"model-validation-diagnostics.v1",stage:"output_schema",issues:[{code:"invalid_type",path:["private-content"]}],truncated:false}).success).toBe(false);
    expect(await call(response())).not.toHaveProperty("diagnostics");
  });
  it.each([{ model: "unexpected/model" }, { provider: "Different Provider" }])("rejects route drift %s", async (extra) => {
    expect(await call(response(undefined, extra))).toMatchObject({ status: "permanent_failure", reason: "provider_route_mismatch", receipt: { actualMicro: 2 } });
  });
  it.each([401, 429, 503])("records HTTP %s without retrying or disclosing its body", async (status) => {
    globalThis.fetch = vi.fn(async () => new Response("private diagnostic", { status })) as typeof fetch;
    const result = await executeModelRequest(request(), { apiKey: "test-not-billed", signal: new AbortController().signal });
    expect(result.status).toBe(status === 401 ? "permanent_failure" : "transient_failure");
    expect(result.receipt.actualMicro).toBeNull(); expect(JSON.stringify(result)).not.toContain("private diagnostic");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds bodies and a transport that ignores abort, without a second request", async () => {
    globalThis.fetch = vi.fn(async () => new Response("x".repeat(1_000_001))) as typeof fetch;
    expect(await executeModelRequest(request(), { apiKey: "test", signal: new AbortController().signal })).toMatchObject({ status: "invalid_output", reason: "provider_response_too_large" });
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as typeof fetch;
    expect(await executeModelRequest(request(), { apiKey: "test", signal: new AbortController().signal, deadlineMs: 10 })).toMatchObject({ status: "outcome_unknown" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch a cancelled operation", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    expect(await executeModelRequest(request(), { apiKey: "test", signal: AbortSignal.abort() })).toMatchObject({ status: "refused" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

it.each([
 ["No endpoints found matching your data policy. private diagnostic", "data_policy"],
 ["0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. ZDR violation (account settings): 1 endpoint excluded", "data_policy"],
 ["No endpoints found that support the requested parameters", "parameters"],
 ["No endpoints available at the requested price", "price"],
 ["No endpoints found for this model", "no_endpoints"],
])("retains a redacted routing failure category: %s",async(message,category)=>{
 globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({error:{code:404,message}}),{status:404}));
 const result=await executeModelRequest(request(),{apiKey:"test-not-billed",signal:new AbortController().signal});
 expect(result).toMatchObject({status:"permanent_failure",reason:`provider_http_404_${category}`,receipt:{httpStatus:404,actualMicro:null,providerId:null,responseDigest:expect.stringMatching(/^[a-f0-9]{64}$/)}});
 expect(JSON.stringify(result)).not.toContain(message);expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it("bounds HTTP error bodies and keeps unknown spend",async()=>{
 globalThis.fetch=vi.fn(async()=>new Response("x".repeat(65537),{status:404}));
 expect(await executeModelRequest(request(),{apiKey:"test",signal:new AbortController().signal})).toMatchObject({status:"permanent_failure",reason:"provider_http_404",receipt:{actualMicro:null,responseDigest:null}});
});

it("preserves the exact legacy request digest and pins an explicit Azure ZDR request",async()=>{
 const legacy=prepareModelRequest("review_coverage",context);
 expect(legacy.digest).toBe("3b996ebffddecd4b7154edd5817dc234a76333c7253b15df18a3e91f567dae98");
 const azure=prepareModelRequest("review_coverage",context,"openrouter-azure-mini-zdr-text-v1");
 const body=JSON.parse(azure.body);
 expect(body.provider).toEqual({only:["azure"],allow_fallbacks:false,require_parameters:true,data_collection:"deny",zdr:true,max_price:{prompt:0.15,completion:0.6,request:0}});
 expect(body.max_completion_tokens).toBe(4096);expect(body).not.toHaveProperty("max_tokens");expect(azure.digest).not.toBe(legacy.digest);
 globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(response(undefined,{provider:"Azure"}))));
 expect(await executeModelRequest(azure,{apiKey:"nonbillable",signal:new AbortController().signal})).toMatchObject({status:"succeeded",receipt:{reportedProvider:"Azure"}});
 globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(response(undefined,{provider:"OpenAI"}))));
 expect(await executeModelRequest(azure,{apiKey:"nonbillable",signal:new AbortController().signal})).toMatchObject({status:"permanent_failure",reason:"provider_route_mismatch"});
 expect(()=>prepareModelRequest("brief",context,"unregistered-policy")).toThrow("unsupported_model_policy");
});

it("attributes actual cost, tokens and cache-read/write fields to the selected model/provider", async () => {
  const result = await call(response(undefined, {
    usage: {
      cost: "0.0000011",
      prompt_tokens: 20,
      completion_tokens: 10,
      cache_read_tokens: 4,
      cache_write_tokens: 3,
    },
  }));
  expect(result).toMatchObject({
    status: "succeeded",
    receipt: {
      requestedModel: "openai/gpt-4o-mini",
      reportedModel: "openai/gpt-4o-mini",
      reportedProvider: "OpenAI",
      actualMicro: 2,
      promptTokens: 20,
      completionTokens: 10,
      cacheReadTokens: 4,
      cacheWriteTokens: 3,
    },
  });
});

it("reads cache tokens from prompt_tokens_details when top-level fields are absent", async () => {
  const result = await call(response(undefined, {
    usage: { cost: "0.0000011", prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 1 } },
  }));
  expect(result).toMatchObject({ status: "succeeded", receipt: { cacheReadTokens: 7, cacheWriteTokens: 1, actualMicro: 2 } });
});

it("keeps missing cost unconfirmed rather than relabeling the reserve", async () => {
  const result = await call(response(undefined, { usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  expect(result).toMatchObject({ status: "succeeded", receipt: { actualMicro: null, rawCost: null, cacheReadTokens: null, cacheWriteTokens: null } });
  expect(result.receipt.actualMicro).not.toBe(STRUCTURED_CALL_RESERVE_MICRO);
});

