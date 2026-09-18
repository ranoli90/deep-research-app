import { afterEach,describe,it,expect,vi } from "vitest";
import { liveWebSearch } from "../src/adapters/retrieval/live-web.js";
import { loadConfig } from "../src/platform/config.js";
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;});
const config=loadConfig({DATABASE_URL:"postgres://localhost/test",OPENROUTER_API_KEY:"test-only",LIVE_SPEND_CAP_MICRO:"1000000"});
const citation={type:"url_citation",url_citation:{url:"https://example.org/source",title:"Source",content:"A qualified excerpt."}};
const envelope={id:"test",model:config.openRouterModel,usage:{cost:"0.000002"},choices:[{finish_reason:"stop",message:{annotations:[citation]}}]};
function transport(value:unknown=envelope){globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(value),{status:200})) as typeof fetch;}
describe("W02/W05 bounded search transport",()=>{
 it("accepts bounded citations with actual cost and forbids redirects",async()=>{
  transport();const r=await liveWebSearch("restoration",config);expect(r.receipt).toMatchObject({state:"confirmed",actualMicro:2,responseDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(r.hits[0]).toMatchObject({locator:"https://example.org/source",snippet:"A qualified excerpt.",originCluster:"https://example.org"});
  expect(vi.mocked(fetch).mock.calls[0]![1]!.redirect).toBe("error");
 });
 it("keeps malformed annotation costs without a successful search",async()=>{
  transport({...envelope,choices:[{message:{annotations:"bad"}}]});const r=await liveWebSearch("restoration",config);
  expect(r.hits).toEqual([]);expect(r.receipt).toMatchObject({state:"failed",actualMicro:2,failureReason:"invalid_search_output"});
 });
 it("rejects oversized citation collections and unfinished outputs",async()=>{
  for(const choices of [[{message:{annotations:Array(4).fill(citation)}}],[{finish_reason:"length",message:{annotations:[citation]}}]]){
   transport({...envelope,choices});const r=await liveWebSearch("restoration",config);expect(r.receipt.state).toBe("failed");expect(r.receipt.actualMicro).toBe(2);expect(r.hits).toEqual([]);
  }
 });
 it("does not synthesize snippets from titles or turn missing cost into zero",async()=>{
  transport({choices:[{message:{annotations:[{...citation,url_citation:{url:"https://example.org",title:"Title only"}}]}}]});
  const r=await liveWebSearch("restoration",config);expect(r.hits[0]!.snippet).toBe("");expect(r.receipt.state).toBe("outcome-unknown");expect(r.receipt.actualMicro).toBeUndefined();
 });
 it("rejects response bodies above the byte bound and invalid UTF8",async()=>{
  for(const bytes of [new Uint8Array(1_000_001),new Uint8Array([0xff])]){
   globalThis.fetch=vi.fn(async()=>new Response(bytes)) as typeof fetch;
   const r=await liveWebSearch("restoration",config);expect(r.hits).toEqual([]);expect(r.receipt.state).toBe("failed");expect(r.receipt.actualMicro).toBeUndefined();
  }
 });
 it("times out an ignored abort and never retries",async()=>{
  globalThis.fetch=vi.fn(()=>new Promise<Response>(()=>{})) as typeof fetch;
  const r=await liveWebSearch("restoration",config,undefined,10);expect(r.receipt.state).toBe("outcome-unknown");expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("rejects credential-bearing citations while preserving cost",async()=>{
  transport({...envelope,choices:[{message:{annotations:[{...citation,url_citation:{...citation.url_citation,url:"https://user:password@example.org"}}]}}]});
  const r=await liveWebSearch("restoration",config);expect(r.hits).toEqual([]);expect(r.receipt.state).not.toBe("confirmed");expect(r.receipt.actualMicro).toBe(2);
 });
 it("rejects changed returned models and oversized input",async()=>{
  transport({...envelope,model:"other"});expect((await liveWebSearch("restoration",config)).receipt).toMatchObject({state:"failed",actualMicro:2});
  transport();expect((await liveWebSearch("x".repeat(4001),config)).receipt.failureReason).toBe("invalid_search_query");expect(fetch).not.toHaveBeenCalled();
 });
});
