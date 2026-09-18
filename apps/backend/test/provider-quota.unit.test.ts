import {expect,it,vi} from "vitest";
import {readProviderQuota,requireProviderCapacity} from "../src/evaluation/provider-quota.js";
const reply=(data:unknown)=>vi.fn(async()=>new Response(JSON.stringify({data})));
it("uses actual remaining quota without counting historical usage again",async()=>{
 const transport=reply({limit:5,limit_remaining:4.7859228,usage:0.2140772});
 const quota=await readProviderQuota("nonbillable-test-key",transport);
 expect(quota).toMatchObject({version:"openrouter-key-quota.v1",limitUsd:5,remainingUsd:4.7859228,usageUsd:0.2140772});
 expect(()=>requireProviderCapacity(quota,400000)).not.toThrow();
 expect(()=>requireProviderCapacity({...quota,usageUsd:500},400000)).not.toThrow();
 expect(()=>requireProviderCapacity(quota,4785923)).toThrow("provider_quota_insufficient");
 expect(transport).toHaveBeenCalledExactlyOnceWith("https://openrouter.ai/api/v1/key",expect.objectContaining({method:"GET",redirect:"error",signal:expect.any(AbortSignal)}));
});
it.each([{}, {limit:5,limit_remaining:-1,usage:0},{limit:5,limit_remaining:6,usage:0},{limit:5,limit_remaining:null,usage:0},{limit:null,limit_remaining:1,usage:0},{limit:5,limit_remaining:"4",usage:0}])("rejects invalid quota metadata %j",async data=>{
 await expect(readProviderQuota("nonbillable-test-key",reply(data))).rejects.toThrow("provider_quota_unavailable");
});
it.each([401,403,500])("does not use an unavailable quota or expose response body %i",async status=>{
 await expect(readProviderQuota("nonbillable-test-key",vi.fn(async()=>new Response("private upstream error",{status})))).rejects.toThrow(/^provider_quota_unavailable$/);
});
it("rejects oversized metadata",async()=>{await expect(readProviderQuota("nonbillable-test-key",vi.fn(async()=>new Response(" ".repeat(65537))))).rejects.toThrow("provider_quota_unavailable");});
it("unlimited provider capacity never supplies application monetary authority",async()=>{
 const quota=await readProviderQuota("nonbillable-test-key",reply({limit:null,limit_remaining:null,usage:2}));
 expect(()=>requireProviderCapacity(quota,0)).toThrow("invalid_forward_budget");
 expect(()=>requireProviderCapacity(quota,400000)).not.toThrow();
});
it("retains a bounded public error for opaque failures and absent credentials",async()=>{
 const transport=vi.fn(async()=>{throw Error("secret upstream text");});
 await expect(readProviderQuota("",transport)).rejects.toThrow(/^provider_quota_unavailable$/);expect(transport).not.toHaveBeenCalled();
 await expect(readProviderQuota("nonbillable-test-key",transport)).rejects.toThrow(/^provider_quota_unavailable$/);
});
