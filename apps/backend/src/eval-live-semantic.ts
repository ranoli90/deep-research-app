import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CreateRunRequestSchema } from "@deep/contracts";
import { compileResearchIntent } from "@deep/research-core";
import { STRUCTURED_CALL_RESERVE_MICRO, modelPolicy } from "./ports/model-policy.js";
import { createPool, migrate } from "./platform/db.js";
import { loadConfig } from "./platform/config.js";
import { createDevSession, grantConsent } from "./modules/access.js";
import { admitRun } from "./modules/run-admission.js";
import { claimLease, cancelRun } from "./modules/runs.js";
import { insertSource, insertVersionAndPassage } from "./modules/evidence.js";
import { fencedSession } from "./worker/fenced-session.js";
import { performModelOperation } from "./worker/model-gateway.js";
import { readProviderQuota, requireProviderCapacity } from "./evaluation/provider-quota.js";
import {
  DOCUMENT_GROUNDED_PASSAGE,
  DOCUMENT_GROUNDED_QUESTION,
  authorizeLiveSemantic,
  sha256,
  type LiveSemanticTaskClass,
} from "./evaluation/live-semantic.js";
import { nextAttemptDecision } from "./model-governor/index.js";
import type { ModelContext } from "./ports/model.js";

const TASKS: Record<LiveSemanticTaskClass, { question: string; correctedQuestion?: string; grounded?: boolean }> = {
  one_sentence_purchase_comparison: { question: "best laptop for running AI under 2k" },
  technical_compatibility_conflict: { question: "Is PostGIS compatible with Postgres 16 vs Postgres 15?" },
  freshness_sensitive_fact: { question: "What is the current US federal funds rate?" },
  document_grounded_check: { question: DOCUMENT_GROUNDED_QUESTION, grounded: true },
  correction: {
    question: "What is the filing deadline for employment tax in Germany?",
    correctedQuestion: "The jurisdiction is France, not Germany. What is the filing deadline?",
  },
  unknown_is_correct: {
    question: "What is the unpublished internal lot code printed on the unreleased Acme Widget 4 firmware that ships next week?",
  },
};

function contextFor(question: string, owned?: { passageId: string; sourceVersionId: string; sourceId: string }): ModelContext {
  const passages = owned ? [{
    id: owned.passageId,
    sourceVersionId: owned.sourceVersionId,
    digest: createHash("sha256").update(DOCUMENT_GROUNDED_PASSAGE).digest("hex"),
    accessLevel: "full-text" as const,
    text: DOCUMENT_GROUNDED_PASSAGE,
  }] : [];
  return {
    question,
    task: null,
    passages,
    sources: owned ? [{ handle: owned.sourceId, title: "SQLite WAL" }] : [],
    assertions: [],
    approvedClaimKeys: [],
    draft: null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean" },
      "operator-confirms-user-approval": { type: "boolean" },
      authorization: { type: "string" },
      sha256: { type: "string" },
      "approval-id": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  if (!values.execute || !values["operator-confirms-user-approval"] || !values.authorization || !values.sha256 || !values["approval-id"] || !values.output) {
    throw new Error("explicit_current_approval_required");
  }
  const raw = await readFile(values.authorization, "utf8");
  const grant = authorizeLiveSemantic(raw, {
    execute: values.execute,
    operatorConfirmsUserApproval: values["operator-confirms-user-approval"],
    approvalId: values["approval-id"],
    sha256: values.sha256,
  });
  const secrets = [process.env.OPENROUTER_API_KEY].filter((v): v is string => !!v);
  await mkdir(resolve(values.output));
  const file = await open(resolve(values.output, "receipts.jsonl"), "wx", 0o600);
  let journalTail = Promise.resolve();
  const journal = (record: Record<string, unknown>) => {
    const line = JSON.stringify(record, (_key, value) =>
      typeof value === "string" ? secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), value) : value);
    const write = journalTail.then(async () => { await file.write(`${line}\n`); await file.sync(); });
    journalTail = write;
    return write;
  };
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("dedicated_existing_session_required");
  const policy = modelPolicy(grant.policyId);
  await journal({
    event: "environment",
    commit: process.env.EVAL_COMMIT ?? "unrecorded",
    policyId: policy.id,
    model: policy.model,
    provider: policy.provider,
    budgetMicro: grant.budgetMicro,
    taskClasses: grant.taskClasses,
    superiorityClaim: false,
  });
  const quota = await readProviderQuota(apiKey);
  await journal({ event: "provider_quota_preflight", quota, budgetMicro: grant.budgetMicro });
  requireProviderCapacity(quota, grant.budgetMicro);
  const pool = createPool(databaseUrl);
  await migrate(pool);
  const session = await createDevSession(pool);
  await grantConsent(pool, session.accountId);
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: databaseUrl,
    LIVE_ROUTE_ENABLED: "true",
    STRUCTURED_MODEL_ENABLED: "true",
    STRUCTURED_MODEL_POLICY_ID: policy.id,
    OPENROUTER_MODEL: policy.model,
    LIVE_SPEND_CAP_MICRO: String(grant.budgetMicro),
    LIVE_KEY_SPEND_CAP_MICRO: String(grant.budgetMicro),
    LIVE_BUDGET_SCOPE: grant.budgetScope,
    DEV_ALLOW_FIXTURE_ROUTE: "false",
  });
  let halted: string | null = null;
  let attempts = 0;
  let confirmedMicro = 0;
  try {
    for (const taskClass of grant.taskClasses) {
      if (halted) break;
      if (attempts >= grant.maxAttempts) { halted = "max_attempts"; break; }
      const spec = TASKS[taskClass];
      const questions = spec.correctedQuestion ? [spec.question, spec.correctedQuestion] : [spec.question];
      for (const question of questions) {
        if (halted) break;
        if (Date.now() >= Date.parse(grant.expiresAt)) { halted = "approval_expired"; break; }
        if (confirmedMicro + STRUCTURED_CALL_RESERVE_MICRO > grant.budgetMicro) { halted = "budget_unrun"; break; }
        const intent = compileResearchIntent(question);
        const admitted = await admitRun(pool, session.accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({
          question, routeMode: "controlled-research",
        }), { modelPolicyId: policy.id });
        let owned: { passageId: string; sourceVersionId: string; sourceId: string } | undefined;
        if (spec.grounded) {
          const sourceId = await insertSource(pool, {
            accountId: session.accountId,
            runId: admitted.runId,
            locator: "https://sqlite.org/wal.html",
            title: "SQLite WAL",
            publisher: "SQLite",
            originCluster: "sqlite.org",
          });
          const passage = await insertVersionAndPassage(pool, {
            sourceId,
            accountId: session.accountId,
            runId: admitted.runId,
            locator: "https://sqlite.org/wal.html",
            text: DOCUMENT_GROUNDED_PASSAGE,
            accessLevel: "full-text",
          });
          owned = { passageId: passage.passageId, sourceVersionId: passage.versionId, sourceId };
        }
        await journal({
          event: "intent",
          taskClass,
          originalQuestion: intent.originalQuestion,
          hardConstraints: intent.hardConstraints,
          clarificationAsk: intent.clarificationDecision.ask,
          documentGroundedOwnedPassage: Boolean(owned),
        });
        const owner = crypto.randomUUID();
        const fence = await claimLease(pool, admitted.runId, owner, 30_000);
        if (fence == null) throw new Error("lease_unavailable");
        const fenced = fencedSession(pool, {
          runId: admitted.runId, accountId: session.accountId, owner, fence, briefRevision: 1, leaseMs: 30_000,
        });
        attempts += 1;
        await journal({ event: "attempt", taskClass, question, runId: admitted.runId, attempt: attempts });
        try {
          const outcome = await performModelOperation(pool, config, fenced, {
            runId: admitted.runId, accountId: session.accountId, fence, briefRevision: 1, evidenceRevision: 0,
            operation: "brief", context: contextFor(question, owned),
          });
          const result = outcome.kind === "result" ? outcome.result : { status: "blocked", reason: outcome.kind === "blocked" ? outcome.reason : "pending", receipt: null };
          const receipt = "receipt" in result ? result.receipt : null;
          if (receipt?.actualMicro != null) confirmedMicro += receipt.actualMicro;
          await journal({
            event: "result",
            taskClass,
            runId: admitted.runId,
            kind: outcome.kind,
            status: "status" in result ? result.status : "blocked",
            reason: "reason" in result ? result.reason : undefined,
            receipt,
            reused: outcome.kind === "result" ? outcome.reused : false,
            superiorityClaim: false,
          });
          if (outcome.kind === "result" && outcome.result.status === "outcome_unknown") {
            const hold = nextAttemptDecision({
              outcome: "outcome_unknown",
              currentDepth: 0,
              remainingBudgetMicro: grant.budgetMicro - confirmedMicro,
              attemptReserveMicro: STRUCTURED_CALL_RESERVE_MICRO,
              currentPolicyId: policy.id,
            });
            halted = "reason" in hold ? hold.reason : "outcome_unknown";
            await journal({ event: "hold", taskClass, decision: hold });
            break;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 200) : "execution_or_receipt_unconfirmed";
          await journal({ event: "result", taskClass, runId: admitted.runId, kind: "failed", status: "unconfirmed", reason, superiorityClaim: false });
          halted = "execution_or_receipt_unconfirmed";
          break;
        } finally {
          fenced.stop();
          await cancelRun(pool, admitted.runId);
        }
      }
    }
    await journal({
      event: "finished",
      halted,
      attempts,
      confirmedMicro,
      expectedClasses: grant.taskClasses.length,
      semanticScores: null,
      superiorityClaim: false,
      note: "Live brief operations only; not a full source-backed report journey and not a routing superiority claim.",
    });
    if (halted) process.exitCode = 2;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "evaluation_stopped_unconfirmed_or_unavailable";
    await journal({ event: "fatal", reason, semanticScores: null, superiorityClaim: false });
    process.exitCode = 2;
  } finally {
    await journalTail;
    await file.close();
    await pool.end();
  }
}

void main().catch(() => {
  process.stderr.write("eval:live-semantic blocked or stopped: explicit current approval, registered scope, isolated database and verified budget are required. No implicit authorization or automatic retry.\n");
  process.exitCode = 2;
});
