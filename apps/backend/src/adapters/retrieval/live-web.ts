import { pinnedSearchBody,publicSearchDigest } from "../../ports/search.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../../platform/config.js";
import { DISCOVERY_POLICY,discoveryPolicy,discoveryModelPolicy,type SearchResult } from "../../ports/search.js";
type SearchHit=SearchResult["hits"][number];
import { costToMicro } from "../model/usage.js";

export type LiveSearchResult=SearchResult;

/**
 * Live discovery via OpenRouter web plugin. Hits are snippets/URLs only.
 * Full text requires a later safeFetch of http(s) locators. Isolated from fixture catalog.
 */
export async function liveWebSearch(query: string, config: AppConfig, signal?: AbortSignal, deadlineMs=45_000, pinned=false, policyId:string=DISCOVERY_POLICY.id): Promise<LiveSearchResult> {
  const policy=discoveryPolicy(policyId),provider=discoveryModelPolicy(policy.id);
  const correlationId = crypto.randomUUID();
  const body = pinned ? pinnedSearchBody(query,policy.id) : {
    model: config.openRouterModel,
    max_tokens: 1024,
    plugins: [{ id: "web", max_results: policy.maxResults }],
    messages: [
      {
        role: "user",
        content: `Find up to ${policy.maxResults} public web sources for this research query. Return nothing but the sources; do not invent URLs.\n\nQuery: ${query}`,
      },
    ],
  };
  const digest = createHash("sha256").update(pinned?JSON.stringify(body):JSON.stringify({ q: query, model: config.openRouterModel })).digest("hex");
  const receipt: LiveSearchResult["receipt"] = {
    correlationId,
    route: pinned?`openrouter:${policy.model}:${policy.id}`:`openrouter:${config.openRouterModel}:web`,
    requestDigest: digest,
    state: "issued",
  };
  if (!config.openRouterApiKey || config.liveSpendCapMicro <= 0) {
    return { hits: [], receipt: { ...receipt, state: "failed" } };
  }
  const fail=(failureReason:string,state:"failed"|"outcome-unknown"="failed"):LiveSearchResult=>({hits:[],receipt:{...receipt,state,failureReason}});
  if(!query.trim()||query.length>4000)return fail("invalid_search_query");
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>45_000)return fail("invalid_search_deadline");
  if(signal?.aborted)return fail("search_cancelled_before_dispatch");
  const boundedSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(deadlineMs)]):AbortSignal.timeout(deadlineMs);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,onAbort:(()=>void)|undefined;
  try {
    const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error("search_aborted"));boundedSignal.addEventListener("abort",onAbort,{once:true});});
    const res=await Promise.race([fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",headers:{Authorization:`Bearer ${config.openRouterApiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify(body),redirect:"error",signal:boundedSignal,
    }),aborted]);
    if(!res.ok) {if(res.body)void res.body.cancel().catch(()=>undefined);return fail(`provider_http_${res.status}`);}
    if(!res.body)return fail("empty_search_response");
    reader=res.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    while(true) {
      const part=await Promise.race([reader.read(),aborted]);if(part.done)break;
      size+=part.value.byteLength;if(size>1_000_000)return fail("search_response_too_large");chunks.push(part.value);
    }
    const raw=Buffer.concat(chunks);receipt.responseDigest=createHash("sha256").update(raw).digest("hex");
    let value:unknown;
    try {value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}catch{return fail("invalid_search_json");}
    const metadata=SearchMetadata.safeParse(value);
    if(!metadata.success)return fail("invalid_search_metadata");
    receipt.providerId=metadata.data.id;
    receipt.actualMicro=costToMicro(metadata.data.usage?.cost);
    receipt.rawCost=receipt.actualMicro===undefined?undefined:String(metadata.data.usage!.cost);
    if(pinned&&(metadata.data.model!==policy.model||metadata.data.provider!==provider.providerName))return fail("search_provider_mismatch");
    if(metadata.data.model&&metadata.data.model!==config.openRouterModel)return fail("search_model_mismatch");
    const parsed=SearchEnvelope.safeParse(value);if(!parsed.success)return fail("invalid_search_output");
    const choice=parsed.data.choices[0]!;
    if((pinned&&choice.finish_reason!=="stop")||choice.finish_reason&&choice.finish_reason!=="stop"||choice.message.refusal)return fail("incomplete_search_output");
    const hits:SearchHit[]=choice.message.annotations.filter((a)=>a.type==="url_citation").map((a)=>{
      if(!a.url_citation)throw new Error("missing_search_citation");
      const c=a.url_citation,url=new URL(c.url);
      if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("invalid_search_url");
      return {locator:url.href,title:c.title||url.href,publisher:url.host,snippet:c.content??"",originCluster:url.origin,family:url.host,sourceType:"web"};
    });
    return {hits:[...new Map(hits.map((h)=>[h.locator,h])).values()],receipt:{...receipt,state:receipt.actualMicro===undefined?"outcome-unknown":"confirmed"}};
  } catch {return fail("search_transport_or_output_unresolved","outcome-unknown");}
  finally {if(onAbort)boundedSignal.removeEventListener("abort",onAbort);if(reader)void reader.cancel().catch(()=>undefined);}

}

const SearchMetadata=z.object({id:z.string().max(300).optional(),model:z.string().max(300).optional(),provider:z.string().max(300).optional(),
  usage:z.object({cost:z.union([z.string().max(100),z.number()]).optional()}).optional()});
const SearchEnvelope=SearchMetadata.extend({choices:z.array(z.object({finish_reason:z.string().max(100).nullable().optional(),
  message:z.object({content:z.string().max(800_000).nullable().optional(),refusal:z.string().max(4000).nullable().optional(),
    annotations:z.array(z.object({type:z.string().max(100),url_citation:z.object({url:z.string().url().max(4000),
      title:z.string().max(500).optional(),content:z.string().max(24000).optional(),start_index:z.number().int().optional(),end_index:z.number().int().optional()}).optional()})).max(3).default([])})})).length(1)});

export { pinnedSearchBody,publicSearchDigest } from "../../ports/search.js";
