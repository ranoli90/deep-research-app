import { afterEach, describe, expect, it, vi } from "vitest";
import { executeModelRequest, prepareModelRequest } from "../src/adapters/model/openrouter.js";
import { STRUCTURED_CALL_RESERVE_MICRO } from "../src/adapters/model/policy.js";
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
