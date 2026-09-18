import { z } from "zod";
const Key=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const EvidenceCalculationActionSchema=z.object({type:z.literal("calculate"),
 formula:z.enum(["sum","difference","product","ratio","percentage","annual_cost"]),
 inputs:z.array(z.object({claimKey:Key,quantityIndex:z.number().int().min(0).max(11)}).strict()).min(1).max(50)
  .refine(xs=>new Set(xs.map(x=>`${x.claimKey}:${x.quantityIndex}`)).size===xs.length,"Duplicate calculation input")}).strict();
export type EvidenceCalculationAction=z.infer<typeof EvidenceCalculationActionSchema>;
