import { z } from "zod";

const Ref = z.string().min(1).max(200);
const Text = z.string().min(1).max(4000);
const Selection = { selectionReason: Text.optional() };
const Target = { targetConclusion: Text, falsificationHypothesis: Text };
const Check = z.enum(["date", "geography", "population", "version", "units", "scope", "contradiction", "support"]);

/** Only named, bounded data arguments may reach an executor. No arbitrary command/expression/policy object. */
export const ExecutableArguments = {
  clarify: z.object({ ...Selection, questions: z.array(z.string().min(1).max(1000)).min(1).max(10) }).strict(),
  search: z.object({ ...Selection, query: Text, coverageId: Ref.optional(), pivot: z.boolean().optional(),
    trigger: Ref.optional(), sourceTypeNeeded: z.string().min(1).max(100).optional(), pivotReason: Text.optional(),
    disconfirm: z.boolean().optional(), targetConclusion: Text.optional(), falsificationHypothesis: Text.optional() }).strict(),
  fetch: z.object({ ...Selection, locator: z.string().min(1).max(4000), sourceId: Ref.optional() }).strict(),
  extract_text: z.object({ ...Selection, sourceId: Ref, sourceVersionId: Ref }).strict(),
  extract_table: z.object({ ...Selection, sourceId: Ref, sourceVersionId: Ref, page: z.number().int().min(1).max(200) }).strict(),
  inspect_visual: z.object({ ...Selection, sourceId: Ref, sourceVersionId: Ref, page: z.number().int().min(1).max(200) }).strict(),
  compare: z.object({ ...Selection, candidateIds: z.array(Ref).min(2).max(50), criterionIds: z.array(Ref).min(1).max(50) }).strict(),
  calculate: z.object({ ...Selection, formula: z.enum(["sum", "difference", "product", "ratio", "percentage", "annual_cost"]),
    inputClaimIds: z.array(Ref).min(1).max(50) }).strict(),
  verify: z.object({ ...Selection, claimId: Ref.optional(), contradictionId: Ref.optional(),
    checks: z.array(Check).min(1).max(8).optional(), possibleExplanation: Text.optional() }).strict()
    .refine((args) => Boolean(args.claimId || args.contradictionId), "verification target required"),
  challenge: z.union([
    z.object({ ...Selection, ...Target, query: Text, disconfirm: z.literal(true).optional(), recordOnly: z.literal(false).optional() }).strict(),
    z.object({ ...Selection, ...Target, recordOnly: z.literal(true) }).strict(),
  ]),
  replan: z.object({ ...Selection, reason: Text, criterionIds: z.array(Ref).min(1).max(50) }).strict(),
  synthesize: z.object({ ...Selection, reason: Text.optional(), stopPolicy: Text.optional() }).strict(),
  stop: z.object({ ...Selection, reason: Text.optional(), stopPolicy: Text.optional() }).strict(),
} as const;
export type ExecutableActionKind = keyof typeof ExecutableArguments;
export type ExecutableAction = { [K in ExecutableActionKind]: { type: K; arguments: z.infer<(typeof ExecutableArguments)[K]> } }[ExecutableActionKind];
