import { z } from "zod";
export const SCOPE_COMPARISON_VERSION = "scope-comparison.v1";
const Key=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const CompareScopesActionSchema=z.object({type:z.literal("compare_scopes"),claimKeys:z.array(Key).min(2).max(60)
  .refine(keys=>new Set(keys).size===keys.length,"Duplicate comparison target")}).strict();
export const ScopeComparisonResultSchema=z.object({version:z.literal(SCOPE_COMPARISON_VERSION),
 pairs:z.array(z.object({leftKey:Key,rightKey:Key,criterionKeys:z.array(Key).min(1).max(24),
  status:z.enum(["different_scope","scope_matches","scope_incomplete"]),
  fields:z.array(z.object({field:z.enum(["entity","plan","version","geography","time","population"]),
   left:z.string().max(300).nullable(),right:z.string().max(300).nullable(),relation:z.enum(["equal","different","unknown"])}).strict()).length(6),
  // Predicate equivalence and factual agreement require separate evidence checking.
  quantityCompatibility:z.literal("not_assessed"),entailment:z.literal("not_assessed")}).strict()).max(1770),
 excludedUnrelatedPairs:z.number().int().min(0).max(1770)}).strict();
export type ScopeComparisonResult=z.infer<typeof ScopeComparisonResultSchema>;
