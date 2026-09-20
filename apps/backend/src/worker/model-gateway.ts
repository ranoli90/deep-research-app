import { persistOperationRoute, recordModelRouteOutcome } from "../modules/model-operation-routing.js";
import {runModelPolicy} from "../modules/run-model-policy.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { CONSENT_POLICY_VERSION, ResearchModelOutputs, type ResearchModelOperation, type ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings, resolveModelSpans, repairBriefCriterionLinks, repairBriefProvenanceFromQuestion, suppressUnneededBriefClarifications, dropUnownedEvidenceHandles, dropUnresolvedExtractionSpans, dropVacuousAssertions, uniquifyExtractionKeys, dropUnapprovedWriterClaims, repairSupportAssessments, repairCoverageReview, MODEL_SPAN_RESOLUTION_VERSION, type SpanResolution } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { isStrictModelPolicy, modelPolicy, AZURE_ZDR_MODEL_POLICY, AZURE_ZDR_EXACT_QUOTE_POLICY, AZURE_ZDR_DISCOVERY_POLICY } from "../ports/model-policy.js";
import { emitEvent, getBrief, getRun } from "../modules/runs.js";
import { withTx } from "../platform/db.js";
import type { FencedSession } from "./fenced-session.js";
import { ModelContextSchema, ModelReceiptSchema, ModelValidationDiagnosticsSchema, type ModelContext, type ModelResult, type PreparedModelRequest } from "../ports/model.js";
import { executeModelRequest, prepareModelRequest } from "../adapters/model/openrouter.js";
import { knownFinancialOutcome, providerIntentStateForResult } from "../adapters/model/outcomes.js";
import { STRUCTURED_MODEL_POLICY } from "../adapters/model/policy.js";
import { reserveMicroForOperation, routeStringFor } from "../adapters/model/token-budget.js";
import { availabilityFailover, nextAttemptDecision } from "../model-governor/index.js";
import { reserveLiveAttempt } from "../modules/live-spend.js";
import { updateIntentState } from "../modules/billing.js";
import { loadLatestModelOperationAttempt, loadModelOperation, modelOperationLogicalDigest, recordModelOperationAttempt, saveModelOperation, validateOwnedModelContext } from "../modules/model-operations.js";

type Outcome<K extends ResearchModelOperation> = { kind: "result"; intentId: string; reused: boolean; result: ModelResult<K> }
  | { kind: "blocked"; reason: string } | { kind: "pending"; intentId: string };
type ActiveRequest<K extends ResearchModelOperation> = PreparedModelRequest<K> & { digest: string };
const Cached = z.object({ status: z.enum(["succeeded","refused","invalid_output","transient_failure","permanent_failure","outcome_unknown"]),
  output: z.unknown().optional(), reason: z.string().optional(), receipt: ModelReceiptSchema, diagnostics: ModelValidationDiagnosticsSchema.optional() }).strict();

function requestDigest<K extends ResearchModelOperation>(prepared: PreparedModelRequest<K>, briefRevision: number, evidenceRevision: number): string {
  return createHash("sha256").update(JSON.stringify({ digest: prepared.digest,
    policy: prepared.policyId, schema: prepared.schemaVersion, prompt: prepared.promptVersion,
    brief: briefRevision, evidence: evidenceRevision })).digest("hex");
}
function isAvailabilityFailure(result: { status: string; reason?: string }): boolean {
  return result.status === "transient_failure" || (result.status === "permanent_failure" && /^provider_http_404/.test(result.reason ?? ""));
}
function parseCached<K extends ResearchModelOperation>(cached: unknown, operation: K, context: ModelContext):
  { kind: "result"; result: ModelResult<K> } | { kind: "blocked"; reason: string } | { kind: "empty" } {
  if (!cached) return { kind: "empty" };
  const parsed = Cached.safeParse(cached);
  if (!parsed.success || (parsed.data.status !== "succeeded" && typeof parsed.data.reason !== "string") || (parsed.data.status === "succeeded" && (!ResearchModelOutputs[operation].safeParse(parsed.data.output).success || validateModelBindings(operation, parsed.data.output, context).length))) {
    return { kind: "blocked", reason: "invalid_stored_model_result" };
  }
  return { kind: "result", result: cached as ModelResult<K> };
}

/** All model operations share this durable, fenced path. Provider transport never owns permissions. */
export async function performModelOperation<K extends ResearchModelOperation>(pool: pg.Pool, config: AppConfig, session: FencedSession, args: {
  runId: string; accountId: string; fence: number; briefRevision: number; evidenceRevision: number;
  operation: K; context: unknown; repairPass?: number; historical?: boolean;
}): Promise<Outcome<K>> {
  if (!config.structuredModelEnabled || !config.liveRouteEnabled || config.openRouterModel !== STRUCTURED_MODEL_POLICY.model) return { kind: "blocked", reason: "structured_model_policy_unavailable" };
  let policy:Awaited<ReturnType<typeof runModelPolicy>>;
  try { policy=await session.write(db=>runModelPolicy(db,args.runId)); } catch(error) { if(error instanceof Error&&error.message==="unsupported_model_policy")return {kind:"blocked",reason:"unsupported_model_policy"};throw error; }
  const context = ModelContextSchema.parse(args.context);
  let extras: Parameters<typeof prepareModelRequest>[3] = args.repairPass ? { repairPass: args.repairPass } : undefined;
  let prepared: ReturnType<typeof prepareModelRequest<K>>;
  try { prepared = prepareModelRequest(args.operation, context,policy.id, extras); }
  catch(error) {
    if(error instanceof Error && ["model_context_too_large","model_context_exceeds_policy"].includes(error.message))
      return {kind:"blocked",reason:error.message};
    throw error;
  }
  let request: ActiveRequest<K> = { ...prepared, digest: requestDigest(prepared, args.briefRevision, args.evidenceRevision) };
  const historical=Boolean(args.historical);
  const logicalDigest = modelOperationLogicalDigest({
    operation: args.operation, context, briefRevision: args.briefRevision, evidenceRevision: args.evidenceRevision,
    schemaVersion: request.schemaVersion, promptVersion: request.promptVersion, repairPass: args.repairPass,
  });
  await session.write((db) => validateOwnedModelContext(db, { ...args, context, historical }));
  if (args.repairPass) {
    const priorDigest = modelOperationLogicalDigest({
      operation: args.operation, context, briefRevision: args.briefRevision, evidenceRevision: args.evidenceRevision,
      schemaVersion: request.schemaVersion, promptVersion: request.promptVersion, repairPass: 0,
    });
    const prior = await session.write((db) => loadLatestModelOperationAttempt(db, { runId: args.runId, accountId: args.accountId, logicalDigest: priorDigest }));
    if (!prior) return { kind: "blocked", reason: "repair_requires_prior_attempt" };
    const priorPrepared = prepareModelRequest(args.operation, context, prior.policyId);
    const priorRequest: ActiveRequest<K> = { ...priorPrepared, digest: prior.requestDigest };
    const cached = await session.write((db) => loadModelOperation(db, prior.intentId, args.runId, args.accountId, prior.requestDigest, context, priorRequest));
    const parsed = parseCached(cached, args.operation, context);
    if (parsed.kind === "empty") return { kind: "pending", intentId: prior.intentId };
    if (parsed.kind === "blocked") return parsed;
    if (parsed.result.status !== "invalid_output" || !knownFinancialOutcome(parsed.result)) {
      return { kind: "result", intentId: prior.intentId, reused: true, result: parsed.result };
    }
    if (isStrictModelPolicy(policy.id)) {
      extras = { repairPass: args.repairPass, repairDiagnostics: parsed.result.diagnostics, repairCodes: parsed.result.reason.split(",") };
      prepared = prepareModelRequest(args.operation, context, policy.id, extras);
      request = { ...prepared, digest: requestDigest(prepared, args.briefRevision, args.evidenceRevision) };
    }
  }
  await session.write(db => persistOperationRoute(db, { ...args, logicalDigest, attemptIndex: 0,
    policyId: policy.id, requestDigest: request.digest,
    reserveMicro: reserveMicroForOperation({ operation: args.operation, policyId: policy.id, bodyText: request.body }) }));
  const attempt = await reserveLiveAttempt(pool, config, { runId: args.runId, fence: args.fence, briefRevision: args.briefRevision,
    evidenceRevision: args.evidenceRevision, requiredConsentPolicy: CONSENT_POLICY_VERSION, logicalKey: `model:${args.operation}:${request.digest}`, kind: args.operation,
    modelPolicyId: policy.id, route: routeStringFor(policy.id, args.operation), requestDigest: request.digest, reserveMicro: reserveMicroForOperation({ operation: args.operation, policyId: policy.id, bodyText: request.body }), historical });
  await session.write((db) => recordModelOperationAttempt(db, {
    intentId: attempt.intentId, runId: args.runId, accountId: args.accountId, logicalDigest, attemptIndex: 0,
    predecessorIntentId: null, reason: "primary", requestDigest: request.digest, policyId: policy.id,
  }));

  const restore = async (intentId: string, active: ActiveRequest<K>): Promise<Outcome<K>> => {
    const cached = await session.write((db) => loadModelOperation(db, intentId, args.runId, args.accountId, active.digest, context, active));
    const parsed = parseCached(cached, args.operation, context);
    if (parsed.kind === "empty") return { kind: "pending", intentId };
    if (parsed.kind === "blocked") return parsed;
    return { kind: "result", intentId, reused: true, result: parsed.result };
  };
  const settle = async (intentId: string, result: ModelResult<K>, activePolicyId: string) => {
    await withTx(pool, async (db) => {
      await recordModelRouteOutcome(db, activePolicyId, result.status === "succeeded" ? undefined : result.reason);
      const settled = providerIntentStateForResult(result);
      await updateIntentState(db, intentId, settled.state, settled.confirmedMicro);
      await db.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1", [intentId, JSON.stringify(result.receipt)]);
    });
  };
  const persist = async (intentId: string, active: ActiveRequest<K>, result: ModelResult<K>, policyId: string, resolvedSpans: SpanResolution[], linkedCriteria: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[]) => {
    await session.write(async (db) => {
      await validateOwnedModelContext(db, { ...args, context, historical });
      await saveModelOperation(db, { ...args, intentId, request: active, result, context, historical });
      if (resolvedSpans.length) await emitEvent(db, {runId:args.runId,accountId:args.accountId,type:"model_span_resolution",phase:"verifying",
        summary:"Exact quoted text was located within its original question or passage.",
        payload:{version:MODEL_SPAN_RESOLUTION_VERSION,intentId,requestDigest:active.digest,policyId,resolutions:resolvedSpans}});
      if (linkedCriteria.length) await emitEvent(db, {runId:args.runId,accountId:args.accountId,type:"brief_criterion_link",phase:"preparing",
        summary:"Each research criterion was attached to an evidence-answerable question.",
        payload:{version:"brief-criterion-question-link.v1",intentId,requestDigest:active.digest,policyId,linked:linkedCriteria}});
    });
  };
  const holdUnknown = (result: ModelResult<K>, policyId: string, body: string) => {
    if (result.status !== "outcome_unknown") return;
    const hold = nextAttemptDecision({
      outcome: "outcome_unknown", currentDepth: 0, remainingBudgetMicro: 0,
      attemptReserveMicro: reserveMicroForOperation({ operation: args.operation, policyId, bodyText: body }),
      currentPolicyId: policyId,
    });
    if (hold.retry || hold.escalate) throw new Error("governor_unknown_must_hold");
  };
  const finalizeSucceeded = async (result: ModelResult<K>, activePolicy: ReturnType<typeof modelPolicy>): Promise<{ result: ModelResult<K>; resolvedSpans: SpanResolution[]; linkedCriteria: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[] }> => {
    let next = result;
    let resolvedSpans: SpanResolution[] = [];
    let linkedCriteria: { criterionKey: string; questionKey: string; attachedToExisting: boolean }[] = [];
    if (next.status !== "succeeded") return { result: next, resolvedSpans, linkedCriteria };
    const salvageBrief = activePolicy.id === AZURE_ZDR_EXACT_QUOTE_POLICY.id || activePolicy.id === AZURE_ZDR_DISCOVERY_POLICY.id;
    const locateOwnedBriefQuotes = activePolicy.id !== AZURE_ZDR_MODEL_POLICY.id && activePolicy.id !== STRUCTURED_MODEL_POLICY.id;
    if (args.operation !== "brief" || locateOwnedBriefQuotes) {
      const resolved = resolveModelSpans(args.operation, next.output, context);
      next = { ...next, output: resolved.output }; resolvedSpans = resolved.resolutions;
    }
    if (args.operation === "brief") {
      let briefOut = next.output as ResearchModelOutput<"brief">;
      if (locateOwnedBriefQuotes) {
        briefOut = repairBriefProvenanceFromQuestion(briefOut, context.question);
      }
      if (salvageBrief) {
        const linked = repairBriefCriterionLinks(briefOut);
        briefOut = repairBriefProvenanceFromQuestion(linked.output, context.question);
        linkedCriteria = linked.linked;
      }
      const owned=await getRun(pool,args.runId);
      const constraints=owned? (await getBrief(pool,owned.brief_id)).constraints : [];
      const clarified = suppressUnneededBriefClarifications(briefOut, context.question, constraints);
      next = { ...next, output: clarified as typeof next.output };
    }
    if (args.operation === "review_coverage" && !activePolicy.id.endsWith("strict-v4")) {
      next = { ...next, output: repairCoverageReview(
        next.output as ResearchModelOutput<"review_coverage">,
        context.assertions,
        context.task?.questions.map((q) => q.key) ?? [],
      ) as typeof next.output };
    }
    if (args.operation === "assess_support" && !activePolicy.id.endsWith("strict-v4")) {
      next = { ...next, output: repairSupportAssessments(
        next.output as ResearchModelOutput<"assess_support">, context.assertions, context.passages) as typeof next.output };
    }
    if (args.operation === "extract_assertions") {
      const original = next.output as ResearchModelOutput<"extract_assertions">;
      const hadAssertions = original.assertions.length > 0;
      const owned = new Set(context.passages.map((p) => p.id));
      const located = dropUnresolvedExtractionSpans(dropUnownedEvidenceHandles(original, owned), context.passages);
      if (hadAssertions && !located.assertions.length) {
        next = { status: "invalid_output", reason: "unlocatable_extraction_spans", receipt: next.receipt };
      } else {
        next = { ...next, output: uniquifyExtractionKeys(dropVacuousAssertions(located)) as typeof next.output };
      }
    }
    if (next.status === "succeeded" && (args.operation === "write_report" || args.operation === "write_calculated_report")) {
      const allowedClaims = new Set(context.approvedClaimKeys.filter((k) => context.assertions.some((a) => a.key === k)));
      const allowedQuestions = new Set(context.task?.questions.map((q) => q.key) ?? []);
      // Writer context stamps selected:false until the draft chooses keys. Allow every planned calculation.
      const allowedCalcs = new Set(context.calculations?.entries.map((e) => e.key) ?? []);
      const cleaned = dropUnapprovedWriterClaims(
        next.output as ResearchModelOutput<"write_report" | "write_calculated_report">,
        allowedClaims, allowedQuestions, allowedCalcs,
      );
      if (!cleaned.sections.length) {
        next = { status: "invalid_output", reason: "writer_without_approved_claims", receipt: next.receipt };
      } else {
        next = { ...next, output: cleaned as typeof next.output };
      }
    }
    const errors = next.status === "succeeded" ? validateModelBindings(args.operation, next.output, context) : [];
    if (errors.length) next = { status: "invalid_output", reason: errors.join(","), receipt: next.receipt };
    return { result: next, resolvedSpans, linkedCriteria };
  };

  const latest = await session.write((db) => loadLatestModelOperationAttempt(db, { runId: args.runId, accountId: args.accountId, logicalDigest }));
  if (latest && latest.attemptIndex > 0) {
    const altPrepared = prepareModelRequest(args.operation, context, latest.policyId, extras);
    const altRequest: ActiveRequest<K> = { ...altPrepared, digest: latest.requestDigest };
    return restore(latest.intentId, altRequest);
  }

  let primaryResult: ModelResult<K> | undefined;
  if (!attempt.issue) {
    const restored = await restore(attempt.intentId, request);
    if (restored.kind !== "result") return restored;
    if (!knownFinancialOutcome(restored.result) || !isAvailabilityFailure(restored.result)) return restored;
    primaryResult = restored.result;
  } else {
    primaryResult = await executeModelRequest(request, { apiKey: config.openRouterApiKey!, signal: session.signal });
    holdUnknown(primaryResult, policy.id, request.body);
    const finalized = primaryResult.status === "succeeded" ? await finalizeSucceeded(primaryResult, policy) : { result: primaryResult, resolvedSpans: [] as SpanResolution[], linkedCriteria: [] };
    primaryResult = finalized.result;
    // Financial receipts survive a lost lease/deletion; private model output does not.
    await settle(attempt.intentId, primaryResult, policy.id);
    await persist(attempt.intentId, request, primaryResult, policy.id, finalized.resolvedSpans, finalized.linkedCriteria);
    if (!knownFinancialOutcome(primaryResult) || !isAvailabilityFailure(primaryResult)) {
      return { kind: "result", intentId: attempt.intentId, reused: false, result: primaryResult };
    }
  }

  const runRow = await getRun(pool, args.runId);
  const failover = availabilityFailover({
    outcome: "transient_failure",
    currentPolicyId: policy.id,
    remainingBudgetMicro: Math.max(0, Number(runRow?.budget_micro ?? 0) - Number(runRow?.spent_micro ?? 0)),
    attemptReserveMicro: reserveMicroForOperation({ operation: args.operation, policyId: policy.id, bodyText: request.body }),
  });
  if (failover.action !== "failover") {
    return { kind: "result", intentId: attempt.intentId, reused: !attempt.issue, result: primaryResult };
  }
  const altPrepared = prepareModelRequest(args.operation, context, failover.nextPolicyId, extras);
  const altRequest: ActiveRequest<K> = { ...altPrepared, digest: requestDigest(altPrepared, args.briefRevision, args.evidenceRevision) };
  await session.write(db => persistOperationRoute(db, { ...args, logicalDigest, attemptIndex: 1,
    policyId: failover.nextPolicyId, requestDigest: altRequest.digest,
    reserveMicro: reserveMicroForOperation({ operation: args.operation, policyId: failover.nextPolicyId, bodyText: altRequest.body }) }));
  const altAttempt = await reserveLiveAttempt(pool, config, { runId: args.runId, fence: args.fence, briefRevision: args.briefRevision,
    evidenceRevision: args.evidenceRevision, requiredConsentPolicy: CONSENT_POLICY_VERSION, logicalKey: `model:${args.operation}:${altRequest.digest}`, kind: args.operation,
    modelPolicyId: failover.nextPolicyId, route: routeStringFor(failover.nextPolicyId, args.operation), requestDigest: altRequest.digest, reserveMicro: reserveMicroForOperation({ operation: args.operation, policyId: failover.nextPolicyId, bodyText: altRequest.body }), historical });
  await session.write((db) => recordModelOperationAttempt(db, {
    intentId: altAttempt.intentId, runId: args.runId, accountId: args.accountId, logicalDigest, attemptIndex: 1,
    predecessorIntentId: attempt.intentId, reason: "availability_failover", requestDigest: altRequest.digest, policyId: failover.nextPolicyId,
  }));
  if (!altAttempt.issue) return restore(altAttempt.intentId, altRequest);

  let altResult = await executeModelRequest(altRequest, { apiKey: config.openRouterApiKey!, signal: session.signal });
  holdUnknown(altResult, failover.nextPolicyId, altRequest.body);
  const altPolicy = modelPolicy(failover.nextPolicyId);
  const altFinal = altResult.status === "succeeded" ? await finalizeSucceeded(altResult, altPolicy) : { result: altResult, resolvedSpans: [] as SpanResolution[], linkedCriteria: [] };
  altResult = altFinal.result;
  await settle(altAttempt.intentId, altResult, failover.nextPolicyId);
  await persist(altAttempt.intentId, altRequest, altResult, failover.nextPolicyId, altFinal.resolvedSpans, altFinal.linkedCriteria);
  return { kind: "result", intentId: altAttempt.intentId, reused: false, result: altResult };
}
