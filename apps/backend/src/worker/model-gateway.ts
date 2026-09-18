import {runModelPolicy} from "../modules/run-model-policy.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { CONSENT_POLICY_VERSION, ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings, resolveModelSpans, repairBriefCriterionLinks, type SpanResolution } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { AZURE_ZDR_EXACT_QUOTE_POLICY } from "../ports/model-policy.js";
import { emitEvent } from "../modules/runs.js";
import { withTx } from "../platform/db.js";
import type { FencedSession } from "./fenced-session.js";
import { ModelContextSchema, ModelReceiptSchema, type ModelResult } from "../ports/model.js";
import { executeModelRequest, prepareModelRequest } from "../adapters/model/openrouter.js";
import { STRUCTURED_MODEL_POLICY, STRUCTURED_CALL_RESERVE_MICRO } from "../adapters/model/policy.js";
import { nextAttemptDecision } from "../model-governor/index.js";
import { reserveLiveAttempt } from "../modules/live-spend.js";
import { updateIntentState } from "../modules/billing.js";
import { loadModelOperation, saveModelOperation, validateOwnedModelContext } from "../modules/model-operations.js";

type Outcome<K extends ResearchModelOperation> = { kind: "result"; intentId: string; reused: boolean; result: ModelResult<K> }
  | { kind: "blocked"; reason: string } | { kind: "pending"; intentId: string };
const Cached = z.object({ status: z.enum(["succeeded","refused","invalid_output","transient_failure","permanent_failure","outcome_unknown"]),
  output: z.unknown().optional(), reason: z.string().optional(), receipt: ModelReceiptSchema }).strict();

/** All model operations share this durable, fenced path. Provider transport never owns permissions. */
export async function performModelOperation<K extends ResearchModelOperation>(pool: pg.Pool, config: AppConfig, session: FencedSession, args: {
  runId: string; accountId: string; fence: number; briefRevision: number; evidenceRevision: number;
  operation: K; context: unknown;
}): Promise<Outcome<K>> {
  if (!config.structuredModelEnabled || !config.liveRouteEnabled || config.openRouterModel !== STRUCTURED_MODEL_POLICY.model) return { kind: "blocked", reason: "structured_model_policy_unavailable" };
  let policy:Awaited<ReturnType<typeof runModelPolicy>>;
  try { policy=await session.write(db=>runModelPolicy(db,args.runId)); } catch(error) { if(error instanceof Error&&error.message==="unsupported_model_policy")return {kind:"blocked",reason:"unsupported_model_policy"};throw error; }
  const context = ModelContextSchema.parse(args.context);
  let prepared: ReturnType<typeof prepareModelRequest<K>>;
  try { prepared = prepareModelRequest(args.operation, context,policy.id); }
  catch(error) {
    if(error instanceof Error && ["model_context_too_large","model_context_exceeds_policy"].includes(error.message))
      return {kind:"blocked",reason:error.message};
    throw error;
  }
  const request = { ...prepared, digest: createHash("sha256").update(JSON.stringify({ digest: prepared.digest,
    policy: prepared.policyId, schema: prepared.schemaVersion, prompt: prepared.promptVersion,
    brief: args.briefRevision, evidence: args.evidenceRevision })).digest("hex") };
  await session.write((db) => validateOwnedModelContext(db, { ...args, context }));
  const attempt = await reserveLiveAttempt(pool, config, { runId: args.runId, fence: args.fence, briefRevision: args.briefRevision,
    evidenceRevision: args.evidenceRevision, requiredConsentPolicy: CONSENT_POLICY_VERSION, logicalKey: `model:${args.operation}:${request.digest}`, kind: args.operation,
    route: `openrouter:${STRUCTURED_MODEL_POLICY.model}:${args.operation}`, requestDigest: request.digest, reserveMicro: STRUCTURED_CALL_RESERVE_MICRO });
  if (!attempt.issue) {
    const cached = await session.write((db) => loadModelOperation(db, attempt.intentId, args.runId, args.accountId, request.digest, context, request));
    if (!cached) return { kind: "pending", intentId: attempt.intentId };
    const parsed = Cached.safeParse(cached);
    if (!parsed.success || (parsed.data.status !== "succeeded" && typeof parsed.data.reason !== "string") || (parsed.data.status === "succeeded" && (!ResearchModelOutputs[args.operation].safeParse(parsed.data.output).success || validateModelBindings(args.operation, parsed.data.output, context).length))) {
      return { kind: "blocked", reason: "invalid_stored_model_result" };
    }
    return { kind: "result", intentId: attempt.intentId, reused: true, result: cached as ModelResult<K> };
  }
  let result = await executeModelRequest(request, { apiKey: config.openRouterApiKey!, signal: session.signal });
  if (result.status === "outcome_unknown") {
    const hold = nextAttemptDecision({
      outcome: "outcome_unknown",
      currentDepth: 0,
      remainingBudgetMicro: 0,
      attemptReserveMicro: STRUCTURED_CALL_RESERVE_MICRO,
      currentPolicyId: policy.id,
    });
    if (hold.retry || hold.escalate) throw new Error("governor_unknown_must_hold");
  }
  // Financial receipts survive a lost lease/deletion; private model output does not.
  await withTx(pool, async (db) => {
    await updateIntentState(db, attempt.intentId, result.receipt.actualMicro == null ? "outcome-unknown" : "confirmed", result.receipt.actualMicro ?? undefined);
    await db.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1", [attempt.intentId, JSON.stringify(result.receipt)]);
  });
  let resolvedSpans: SpanResolution[] = [];
  let linkedCriteria: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[] = [];
  if (result.status === "succeeded") {
    if (policy.id === AZURE_ZDR_EXACT_QUOTE_POLICY.id) {
      const resolved = resolveModelSpans(args.operation, result.output, context);
      result = { ...result, output: resolved.output }; resolvedSpans = resolved.resolutions;
      if (args.operation === "brief") {
        const linked = repairBriefCriterionLinks(result.output as ResearchModelOutput<"brief">);
        result = { ...result, output: linked.output as typeof result.output }; linkedCriteria = linked.linked;
      }
    }
    const errors = validateModelBindings(args.operation, result.output, context);
    if (errors.length) result = { status: "invalid_output", reason: errors.join(","), receipt: result.receipt };
  }
  await session.write(async (db) => {
    await validateOwnedModelContext(db, { ...args, context });
    await saveModelOperation(db, { ...args, intentId: attempt.intentId, request, result, context });
    if (resolvedSpans.length) await emitEvent(db, {runId:args.runId,accountId:args.accountId,type:"model_span_resolution",phase:"verifying",
      summary:"Exact quoted text was located within its original question or passage.",
      payload:{version:"unique-exact-quote-offsets.v1",intentId:attempt.intentId,requestDigest:request.digest,policyId:policy.id,resolutions:resolvedSpans}});
    if (linkedCriteria.length) await emitEvent(db, {runId:args.runId,accountId:args.accountId,type:"brief_criterion_link",phase:"preparing",
      summary:"Each research criterion was attached to an evidence-answerable question.",
      payload:{version:"brief-criterion-question-link.v1",intentId:attempt.intentId,requestDigest:request.digest,policyId:policy.id,linked:linkedCriteria}});
  });
  return { kind: "result", intentId: attempt.intentId, reused: false, result };
}
