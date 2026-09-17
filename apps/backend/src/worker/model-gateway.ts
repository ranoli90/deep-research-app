import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { CONSENT_POLICY_VERSION, ResearchModelOutputs, type ResearchModelOperation } from "@deep/contracts";
import { validateModelBindings } from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { withTx } from "../platform/db.js";
import type { FencedSession } from "./fenced-session.js";
import { ModelContextSchema, ModelReceiptSchema, type ModelResult } from "../ports/model.js";
import { executeModelRequest, prepareModelRequest } from "../adapters/model/openrouter.js";
import { STRUCTURED_MODEL_POLICY, STRUCTURED_CALL_RESERVE_MICRO } from "../adapters/model/policy.js";
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
  const context = ModelContextSchema.parse(args.context);
  const prepared = prepareModelRequest(args.operation, context);
  const request = { ...prepared, digest: createHash("sha256").update(JSON.stringify({ digest: prepared.digest,
    policy: prepared.policyId, schema: prepared.schemaVersion, prompt: prepared.promptVersion,
    brief: args.briefRevision, evidence: args.evidenceRevision })).digest("hex") };
  await session.write((db) => validateOwnedModelContext(db, { ...args, context }));
  const attempt = await reserveLiveAttempt(pool, config, { runId: args.runId, fence: args.fence, briefRevision: args.briefRevision,
    evidenceRevision: args.evidenceRevision, requiredConsentPolicy: CONSENT_POLICY_VERSION, logicalKey: `model:${args.operation}:${request.digest}`, kind: args.operation,
    route: `openrouter:${STRUCTURED_MODEL_POLICY.model}:${args.operation}`, requestDigest: request.digest, reserveMicro: STRUCTURED_CALL_RESERVE_MICRO });
  if (!attempt.issue) {
    const cached = await session.write((db) => loadModelOperation(db, attempt.intentId, args.runId, args.accountId, request.digest, context));
    if (!cached) return { kind: "pending", intentId: attempt.intentId };
    const parsed = Cached.safeParse(cached);
    if (!parsed.success || (parsed.data.status !== "succeeded" && typeof parsed.data.reason !== "string") || (parsed.data.status === "succeeded" && (!ResearchModelOutputs[args.operation].safeParse(parsed.data.output).success || validateModelBindings(args.operation, parsed.data.output, context).length))) {
      return { kind: "blocked", reason: "invalid_stored_model_result" };
    }
    return { kind: "result", intentId: attempt.intentId, reused: true, result: cached as ModelResult<K> };
  }
  let result = await executeModelRequest(request, { apiKey: config.openRouterApiKey!, signal: session.signal });
  // Financial receipts survive a lost lease/deletion; private model output does not.
  await withTx(pool, async (db) => {
    await updateIntentState(db, attempt.intentId, result.receipt.actualMicro == null ? "outcome-unknown" : "confirmed", result.receipt.actualMicro ?? undefined);
    await db.query("UPDATE provider_intents SET receipt=$2 WHERE id=$1", [attempt.intentId, JSON.stringify(result.receipt)]);
  });
  if (result.status === "succeeded") {
    const errors = validateModelBindings(args.operation, result.output, context);
    if (errors.length) result = { status: "invalid_output", reason: errors.join(","), receipt: result.receipt };
  }
  await session.write(async (db) => {
    await validateOwnedModelContext(db, { ...args, context });
    await saveModelOperation(db, { ...args, intentId: attempt.intentId, request, result, context });
  });
  return { kind: "result", intentId: attempt.intentId, reused: false, result };
}
