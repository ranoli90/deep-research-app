import {z} from "zod";
export const EvidenceSelectionContextSchema=z.object({
 id:z.string().uuid(),version:z.literal("whole-passage-selection.v1"),proofDigest:z.string().regex(/^[a-f0-9]{64}$/),
 available:z.number().int().min(1).max(4096),selected:z.number().int().min(1).max(128),omitted:z.number().int().nonnegative().max(4096),
}).strict().refine(x=>x.selected+x.omitted===x.available);
export type EvidenceSelectionContext=z.infer<typeof EvidenceSelectionContextSchema>;
