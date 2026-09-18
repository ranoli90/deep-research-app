import { z } from "zod";

const amount = z.number().finite().nonnegative();
const responseSchema = z.object({data:z.object({limit:amount.nullable(),limit_remaining:amount.nullable(),usage:amount,usage_daily:amount.optional()})});
export type ProviderQuota = {version:"openrouter-key-quota.v1";checkedAt:string;limitUsd:number|null;remainingUsd:number|null;usageUsd:number;usageDailyUsd:number|null};
/** Read-only provider capacity, not a per-generation receipt or authority to release local holds. */
export async function readProviderQuota(apiKey:string,transport:typeof fetch=fetch):Promise<ProviderQuota> {
 if(!apiKey.trim())throw Error("provider_quota_unavailable");
 try {
  const response=await transport("https://openrouter.ai/api/v1/key",{method:"GET",headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body){await response.body?.cancel();throw Error();}
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try {while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536){await reader.cancel();throw Error();}chunks.push(part.value);}} finally {reader.releaseLock();}
  const {data}=responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if((data.limit===null)!==(data.limit_remaining===null)||data.limit!==null&&data.limit_remaining!>data.limit)throw Error();
  return {version:"openrouter-key-quota.v1",checkedAt:new Date().toISOString(),limitUsd:data.limit,remainingUsd:data.limit_remaining,usageUsd:data.usage,usageDailyUsd:data.usage_daily??null};
 }catch{throw Error("provider_quota_unavailable");}
}
export function requireProviderCapacity(quota:ProviderQuota,budgetMicro:number):void {
 if(!Number.isSafeInteger(budgetMicro)||budgetMicro<=0)throw Error("invalid_forward_budget");
 // Remaining quota already accounts for provider-reported historical spend. Never subtract it twice.
 // Unlimited keys still require the independent, explicit application budget and reservation gates.
 if(quota.remainingUsd!==null&&Math.floor(quota.remainingUsd*1_000_000)<budgetMicro)throw Error("provider_quota_insufficient");
}
