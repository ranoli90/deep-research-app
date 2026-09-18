import { z } from "zod";

/** Financial metadata only: never retain generation prompts or completions. */
export const GenerationReceiptSchema = z.object({
  version: z.literal("openrouter-generation-cost.v1"),
  providerId: z.string().min(1).max(300),
  model: z.string().min(1).max(300),
  provider: z.string().min(1).max(300),
  actualMicro: z.number().int().nonnegative().safe(),
  rawCost: z.string().min(1).max(100),
  retrievedAt: z.string().datetime(),
  responseDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GenerationReceipt = z.infer<typeof GenerationReceiptSchema>;
export type GenerationLookup = { kind: "receipt"; receipt: GenerationReceipt }
  | { kind: "unavailable"; reason: string };
