import { afterEach,describe,it,expect,vi } from "vitest";
import { liveWebSearch } from "../src/adapters/retrieval/live-web.js";
import { loadConfig } from "../src/platform/config.js";
import {DISCOVERY_POLICY,DEEP_DISCOVERY_POLICY,AZURE_DISCOVERY_POLICY,AZURE_DEEP_DISCOVERY_POLICY,DISCOVERY_RESERVE_MICRO,discoveryPolicyForModel,discoveryPolicyForNewSearch,pinnedSearchBody,publicSearchDigest} from "../src/ports/search.js";
import {STRUCTURED_MODEL_POLICY,AZURE_ZDR_MODEL_POLICY,AZURE_ZDR_EXACT_QUOTE_POLICY,AZURE_ZDR_DISCOVERY_POLICY} from "../src/ports/model-policy.js";
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;});
const config=loadConfig({DATABASE_URL:"postgres://localhost/test",OPENROUTER_API_KEY:"test-only",LIVE_SPEND_CAP_MICRO:"1000000"});
const citation={type:"url_citation",url_citation:{url:"https://example.org/source",title:"Source",content:"A qualified excerpt."}};
const envelope={id:"test",model:config.openRouterModel,usage:{cost:"0.000002"},choices:[{finish_reason:"stop",message:{annotations:[citation]}}]};
function transport(value:unknown=envelope){globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(value),{status:200})) as typeof fetch;}
describe("W02/W05 bounded search transport",()=>{
 it("preserves legacy discovery bytes for every existing admitted model policy",()=>{
  const query="Compare coral and kelp restoration.";
  for(const policy of [STRUCTURED_MODEL_POLICY,AZURE_ZDR_MODEL_POLICY,AZURE_ZDR_EXACT_QUOTE_POLICY]){
   expect(discoveryPolicyForModel(policy.id)).toEqual(DISCOVERY_POLICY);
   expect(publicSearchDigest(query,discoveryPolicyForModel(policy.id).id)).toBe("9fef15d94afec88128678cb3073ab7151e955d7df384dd8fa1f54582dc308c8b");
  }
  expect(()=>discoveryPolicyForModel("unknown-policy")).toThrow("unsupported_model_policy");
 });
 it("issues new searches under v3 with a bounded result count above the historical three",()=>{
  expect(discoveryPolicyForNewSearch(STRUCTURED_MODEL_POLICY.id)).toEqual(DEEP_DISCOVERY_POLICY);
  for(const policy of [AZURE_ZDR_MODEL_POLICY,AZURE_ZDR_EXACT_QUOTE_POLICY,AZURE_ZDR_DISCOVERY_POLICY]){
   expect(discoveryPolicyForNewSearch(policy.id)).toEqual(AZURE_DEEP_DISCOVERY_POLICY);
  }
  const azureBody=pinnedSearchBody("restoration",discoveryPolicyForNewSearch(AZURE_ZDR_MODEL_POLICY.id).id);
  expect(azureBody.provider).toMatchObject({only:["azure"],zdr:true});
  expect(azureBody.plugins[0]).toMatchObject({id:"web",engine:"exa",mode:"auto",max_results:8});
  expect(DEEP_DISCOVERY_POLICY.maxResults).toBe(8);
  expect(AZURE_DEEP_DISCOVERY_POLICY.maxResults).toBe(8);
  expect(DISCOVERY_POLICY.maxResults).toBe(3);
  expect(AZURE_DISCOVERY_POLICY.maxResults).toBe(3);
  expect(pinnedSearchBody("restoration",DISCOVERY_POLICY.id).plugins[0]?.max_results).toBe(3);
  expect(pinnedSearchBody("restoration",AZURE_DISCOVERY_POLICY.id).plugins[0]?.max_results).toBe(3);
  const body=pinnedSearchBody("restoration",DEEP_DISCOVERY_POLICY.id);
  expect(body.plugins[0]).toMatchObject({id:"web",engine:"exa",mode:"auto",max_results:8});
  expect(publicSearchDigest("restoration",DEEP_DISCOVERY_POLICY.id)).not.toBe(publicSearchDigest("restoration",DISCOVERY_POLICY.id));
  expect(publicSearchDigest("restoration",AZURE_DEEP_DISCOVERY_POLICY.id)).not.toBe(publicSearchDigest("restoration",AZURE_DISCOVERY_POLICY.id));
 });
 it("pins new discovery to Azure ZDR with unchanged public plugin and reserve",async()=>{
  const policy=discoveryPolicyForModel(AZURE_ZDR_DISCOVERY_POLICY.id),body=pinnedSearchBody("restoration",policy.id);
  expect(policy).toEqual(AZURE_DISCOVERY_POLICY);expect(DISCOVERY_RESERVE_MICRO).toBe(28658);
  expect(body).toMatchObject({max_completion_tokens:1024,provider:{only:["azure"],zdr:true,allow_fallbacks:false,require_parameters:true,data_collection:"deny",max_price:{prompt:0.15,completion:0.6,request:0}},plugins:[{id:"web",engine:"exa",mode:"auto",max_results:3}]});
  expect(body).not.toHaveProperty("max_tokens");expect(body.messages.at(-1)?.content).toBe("restoration");
  expect(publicSearchDigest("restoration",policy.id)).not.toBe(publicSearchDigest("restoration"));
  transport({...envelope,provider:"Azure"});
  const result=await liveWebSearch("restoration",config,undefined,45000,true,policy.id);
  expect(result.receipt).toMatchObject({state:"confirmed",actualMicro:2,route:`openrouter:${policy.model}:${policy.id}`,requestDigest:publicSearchDigest("restoration",policy.id)});
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual(body);
 });
 it("pins new Azure ZDR searches to v3 with max_results=8 while frozen v2 stays 3",async()=>{
  const policy=discoveryPolicyForNewSearch(AZURE_ZDR_DISCOVERY_POLICY.id),body=pinnedSearchBody("restoration",policy.id);
  expect(policy).toEqual(AZURE_DEEP_DISCOVERY_POLICY);
  expect(discoveryPolicyForModel(AZURE_ZDR_DISCOVERY_POLICY.id)).toEqual(AZURE_DISCOVERY_POLICY);
  expect(body).toMatchObject({max_completion_tokens:1024,provider:{only:["azure"],zdr:true,allow_fallbacks:false,require_parameters:true,data_collection:"deny"},plugins:[{id:"web",engine:"exa",mode:"auto",max_results:8}]});
  expect(pinnedSearchBody("restoration",AZURE_DISCOVERY_POLICY.id).plugins[0]?.max_results).toBe(3);
  transport({...envelope,provider:"Azure"});
  const result=await liveWebSearch("restoration",config,undefined,45000,true,policy.id);
  expect(result.receipt).toMatchObject({state:"confirmed",actualMicro:2,route:`openrouter:${policy.model}:${policy.id}`,requestDigest:publicSearchDigest("restoration",policy.id)});
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual(body);
 });
 it.each(["OpenAI",undefined,"azure/swedencentral"])("rejects drift or missing Azure provider identity: %s",async provider=>{
  transport({...envelope,provider});
  const result=await liveWebSearch("restoration",config,undefined,45000,true,AZURE_DISCOVERY_POLICY.id);
  expect(result).toMatchObject({hits:[],receipt:{state:"failed",actualMicro:2,failureReason:"search_provider_mismatch"}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("rejects unregistered discovery policy before dispatch",async()=>{
  transport();await expect(liveWebSearch("restoration",config,undefined,45000,true,"unknown-policy")).rejects.toThrow("unsupported_discovery_policy");expect(fetch).not.toHaveBeenCalled();
 });
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
  for(const choices of [[{message:{annotations:Array(13).fill(citation)}}],[{finish_reason:"length",message:{annotations:[citation]}}]]){
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
