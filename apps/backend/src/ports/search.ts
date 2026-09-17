import { z } from "zod";
import { STRUCTURED_MODEL_POLICY,STRUCTURED_CALL_RESERVE_MICRO } from "./model-policy.js";
export const DISCOVERY_POLICY={id:"public-discovery.v1",model:STRUCTURED_MODEL_POLICY.model,engine:"exa",mode:"auto",maxResults:3,
  searchFeeMicro:7000,observedAt:"2026-09-17"} as const;
export const DISCOVERY_RESERVE_MICRO=STRUCTURED_CALL_RESERVE_MICRO+DISCOVERY_POLICY.searchFeeMicro;
const PublicUrl=z.string().url().max(4000).refine((s)=>{const u=new URL(s);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password;});
export const SearchResultSchema=z.object({hits:z.array(z.object({locator:PublicUrl,title:z.string().max(4000),publisher:z.string().max(4000),
  snippet:z.string().max(24000),originCluster:z.string().max(4000),family:z.string().max(4000),sourceType:z.string().max(100).optional()}).strict()).max(3),
  receipt:z.object({correlationId:z.string().uuid(),route:z.string().max(300),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),
    state:z.enum(["issued","confirmed","failed","outcome-unknown"]),providerId:z.string().max(300).optional(),actualMicro:z.number().int().nonnegative().safe().optional(),
    rawCost:z.string().max(100).optional(),failureReason:z.string().max(200).optional(),responseDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()}).strict();
export type SearchResult=z.infer<typeof SearchResultSchema>;
