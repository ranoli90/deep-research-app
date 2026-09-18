import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lookupGenerationReceipt } from "../src/adapters/model/generation-receipt.js";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const data = { id: "gen-local-test", model: "openai/gpt-4o-mini", provider_name: "OpenAI", total_cost: "0.00001201" };
const args = () => ({ providerId: data.id, apiKey: "nonbillable-test", signal: new AbortController().signal });
describe("W02 actual generation receipt transport controls", () => {
  it("uses only fixed GET metadata and retains exact cost without provider content", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ...data, prompt: "PRIVATE-OMIT", completion: "OMIT" } })));
    const result = await lookupGenerationReceipt(args());
    expect(result).toMatchObject({ kind: "receipt", receipt: { actualMicro: 13, rawCost: "0.00001201", providerId: data.id } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-OMIT");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/generation?id=gen-local-test");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(init?.body).toBeUndefined();
  });
  it.each([{ ...data, id: "another-generation" }, { ...data, total_cost: -1 }, { ...data, total_cost: "Infinity" },
    { ...data, total_cost: null }, { ...data, provider_name: null }])("does not settle malformed or mismatched metadata", async value => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: value })));
    expect((await lookupGenerationReceipt(args())).kind).toBe("unavailable");
  });
  it("404 is unresolved, never evidence of zero cost", async () => {
    globalThis.fetch = vi.fn(async () => new Response("missing", { status: 404 }));
    expect(await lookupGenerationReceipt(args())).toEqual({ kind: "unavailable", reason: "receipt_http_404" });
  });
  it("bounds body bytes and rejects invalid UTF-8", async () => {
    globalThis.fetch = vi.fn(async () => new Response("x".repeat(64_001)));
    expect(await lookupGenerationReceipt(args())).toEqual({ kind: "unavailable", reason: "receipt_body_too_large" });
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([0xff])));
    expect((await lookupGenerationReceipt(args())).kind).toBe("unavailable");
  });
  it("times out even if transport ignores cancellation", async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined));
    expect((await lookupGenerationReceipt({ ...args(), deadlineMs: 10 })).kind).toBe("unavailable");
  });
  it("keeps its deadline alive through garbage collection while a transport never resolves", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--expose-gc", "--import", "tsx", "--input-type=module", "-e", `
      import { lookupGenerationReceipt } from './src/adapters/model/generation-receipt.ts';
      globalThis.fetch = () => new Promise(() => {});
      const collector = setInterval(() => globalThis.gc(), 1);
      let observer;
      try {
        const result = await Promise.race([
          lookupGenerationReceipt({providerId:'gc-control',apiKey:'nonbillable-test',signal:new AbortController().signal,deadlineMs:30}),
          new Promise(resolve => { observer = setTimeout(() => resolve({kind:'test-deadline-lost'}), 300); })
        ]);
        console.log(JSON.stringify(result));
      } finally { clearInterval(collector); clearTimeout(observer); }
    `], { cwd: new URL("..", import.meta.url), timeout: 3000 });
    expect(JSON.parse(stdout)).toEqual({ kind: "unavailable", reason: "receipt_lookup_unavailable" });
  });
  it("does not fetch for canceled or invalid arguments", async () => {
    globalThis.fetch = vi.fn();
    expect((await lookupGenerationReceipt({ ...args(), signal: AbortSignal.abort() })).kind).toBe("unavailable");
    expect((await lookupGenerationReceipt({ ...args(), providerId: "\nsecret" })).kind).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards caller cancellation after issuance even when transport ignores abort", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = lookupGenerationReceipt({ ...args(), signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ kind: "unavailable", reason: "receipt_lookup_unavailable" });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
