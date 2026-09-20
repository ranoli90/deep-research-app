import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { admitRun } from "../src/modules/run-admission.js";
import { getBrief, getRun } from "../src/modules/runs.js";
import { createDevSession, grantConsent } from "../src/modules/access.js";
import { processRun } from "../src/worker/executor.js";
import { loadSupportContext } from "../src/modules/scoped-support.js";
import { runModelVersions } from "../src/modules/run-model-policy.js";
import * as publicTransport from "../src/platform/ssrf.js";
import * as extraction from "../src/adapters/extraction/offline.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

const ORIGINAL = "What is the filing deadline for employment tax?";
const originalFetch = globalThis.fetch;
let pool: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;

function envelope(output: unknown, extras: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: crypto.randomUUID(),
    model: "openai/gpt-4o-mini",
    provider: "OpenAI",
    usage: { cost: "0.000001" },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output), ...extras } }],
    ...extras,
  }));
}

function briefOutput(question: string) {
  const span = { start: 0, end: question.length, quote: question };
  const needle = "filing deadline";
  const at = question.indexOf(needle);
  const provenance = at >= 0 ? { start: at, end: at + needle.length, quote: needle } : span;
  const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
  return {
    objective: question,
    objectiveProvenance: span,
    intendedOutput: "legal_rule",
    criteria: [{
      key: "jurisdiction_rule", description: "Applicable filing deadline", field: "deadline", operator: "explain",
      value: null, unit: null, importance: "hard", scope, provenance, group: "g", groupOperator: "all", unresolvedAlternatives: [],
    }],
    questions: [{
      key: "q_deadline", text: question, criterionKeys: ["jurisdiction_rule"], importance: "critical",
      evidenceStandard: "primary statute or regulator",
    }],
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  };
}

beforeAll(async () => {
  pool = createPool(TEST_URL);
  await migrate(pool);
  boss = await createQueue(TEST_URL);
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_URL,
    APP_AUTH_MODE: "development",
    DEV_ALLOW_FIXTURE_ROUTE: "true",
    LIVE_ROUTE_ENABLED: "true",
    STRUCTURED_MODEL_ENABLED: "true",
    STRUCTURED_DISCOVERY_ENABLED: "true",
    LIVE_RETRIEVAL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-wave1-indiana",
    LIVE_SPEND_CAP_MICRO: "1000000000",
    LIVE_KEY_SPEND_CAP_MICRO: "1000000000",
    LIVE_BUDGET_SCOPE: crypto.randomUUID(),
  });
  app = await buildApp({ pool, config, boss });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

describe("production continue after geography clarification", () => {
  it("keeps originalQuestion, searches Indiana, and restores extract/support on model-input.v6", async () => {
    const session = await createDevSession(pool);
    await grantConsent(pool, session.accountId);
    const { runId } = await admitRun(pool, session.accountId, crypto.randomUUID(), {
      question: ORIGINAL,
      routeMode: "controlled-research",
      attachmentIds: [],
      consentPolicyVersion: CONSENT_POLICY_VERSION,
    });
    const workerConfig = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: TEST_URL,
      APP_AUTH_MODE: "development",
      LIVE_ROUTE_ENABLED: "true",
      STRUCTURED_MODEL_ENABLED: "true",
      STRUCTURED_DISCOVERY_ENABLED: "true",
      LIVE_RETRIEVAL_ENABLED: "true",
      OPENROUTER_API_KEY: "nonbillable-wave1-indiana",
      LIVE_SPEND_CAP_MICRO: "1000000000",
      LIVE_KEY_SPEND_CAP_MICRO: "1000000000",
      LIVE_BUDGET_SCOPE: crypto.randomUUID(),
    });
    await processRun(pool, workerConfig, runId);
    expect((await getRun(pool, runId))?.lifecycle).toBe("awaiting_input");

    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { geography: "Indiana" },
    });
    expect(cont.statusCode).toBe(200);

    const searches: string[] = [];
    const html = "<!doctype html><html><body><p>Indiana employment tax filing deadline is April 15.</p></body></html>";
    const htmlBytes = Buffer.from(html);
    vi.spyOn(publicTransport, "safeFetch").mockImplementation(async (url) => ({
      url: String(url), body: html, bytes: htmlBytes, status: 200, mime: "text/html", redirectChain: [],
    }));
    vi.spyOn(extraction, "extractOffline").mockResolvedValue({
      version: "utf8-notes-v1",
      digest: createHash("sha256").update(htmlBytes).digest("hex"),
      status: "extracted",
      warnings: [],
      blocks: [{ kind: "text", locator: "html:1/block:0", text: "Indiana employment tax filing deadline is April 15.", rows: [] }],
    });
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.plugins?.length) {
        const query = String(body.messages?.[1]?.content ?? "").split("Query:").pop()?.trim() ?? "";
        searches.push(query);
        return new Response(JSON.stringify({
          id: crypto.randomUUID(),
          model: "openai/gpt-4o-mini",
          provider: "OpenAI",
          usage: { cost: "0.000003" },
          choices: [{
            finish_reason: "stop",
            message: {
              content: "",
              annotations: [{
                type: "url_citation",
                url_citation: {
                  url: "https://example.org/indiana-employment-tax",
                  title: "Indiana filing",
                  content: "Indiana employment tax filing deadline is April 15.",
                },
              }],
            },
          }],
        }));
      }
      const operation = String(body.response_format?.json_schema?.name ?? "");
      const context = JSON.parse(String(body.messages?.[1]?.content ?? "{}"));
      const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
      if (operation === "research_brief_v1") return envelope(briefOutput(context.question));
      if (operation === "research_extract_assertions_v1") {
        const passage = context.passages?.[0];
        const text = "Indiana employment tax filing deadline is April 15.";
        const start = String(passage?.text ?? "").indexOf(text);
        const criterionKeys = context.task?.criteria?.map((c: { key: string }) => c.key) ?? ["jurisdiction_rule"];
        return envelope({
          candidates: [],
          assertions: start >= 0 ? [{
            key: "deadline", candidateKey: null, criterionKeys, text, scope,
            quantities: [], evidence: [{ passageId: passage.id, start, end: start + text.length, quote: text }],
          }] : [],
          limitations: [],
        });
      }
      if (operation === "research_assess_support_v1") {
        return envelope({
          assessments: (context.assertions ?? []).map((a: { key: string; scope: unknown; evidence: unknown }) => ({
            claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence,
            rationale: "Exact sentence", missingEvidence: [],
          })),
        });
      }
      if (operation === "research_review_coverage_v1") {
        const questionKey = context.task?.questions?.[0]?.key ?? "q_deadline";
        return envelope({
          questions: [{ questionKey, status: "supported", assertionKeys: context.approvedClaimKeys ?? [], reason: "Exact sentence" }],
          omittedRequirements: [],
        });
      }
      if (operation === "research_write_report_v1" || operation === "research_write_calculated_report_v1") {
        const claim = context.approvedClaimKeys?.[0];
        const text = context.assertions?.find((a: { key: string }) => a.key === claim)?.text ?? "Indiana employment tax filing deadline is April 15.";
        return envelope({
          title: "Filing deadline",
          sections: [{ heading: "Answer", paragraphs: [{ text, claimKeys: claim ? [claim] : [] }] }],
          unresolvedQuestionKeys: [],
          limitations: [],
          ...(operation === "research_write_calculated_report_v1" ? { calculationKeys: [] } : {}),
        });
      }
      if (operation === "research_plan_calculations_v1") {
        return envelope({ calculations: [], unresolvedQuestionKeys: context.task?.questions?.map((q: { key: string }) => q.key) ?? [], reason: "No quantities" });
      }
      throw new Error(`unexpected_model_operation:${operation}`);
    }) as typeof fetch;

    await processRun(pool, workerConfig, runId);

    const brief = await getBrief(pool, (await getRun(pool, runId))!.brief_id);
    expect(brief.originalQuestion).toBe(ORIGINAL);
    expect(brief.originalQuestion).not.toMatch(/ in Indiana\?/u);
    expect(searches.some((q) => /indiana/i.test(q))).toBe(true);
    expect(searches.some((q) => q.includes(ORIGINAL))).toBe(true);

    const extract = await pool.query<{ intent_id: string; input_manifest: { version: string } }>(
      `SELECT intent_id, input_manifest FROM model_operation_results WHERE run_id=$1 AND operation='extract_assertions' ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    expect(extract.rows[0]?.input_manifest.version).toBe("model-input.v6");
    const continued = await getRun(pool, runId);
    expect(continued?.brief_revision).toBeGreaterThan(1);
    const task = await pool.query<{ id: string }>(`SELECT id FROM research_tasks WHERE run_id=$1 AND brief_revision=$2`, [runId, continued!.brief_revision]);
    await expect(loadSupportContext(pool, {
      runId,
      accountId: session.accountId,
      briefRevision: continued!.brief_revision,
      taskId: task.rows[0]!.id,
      extractionIntentId: extract.rows[0]!.intent_id,
    }, await runModelVersions(pool, runId))).resolves.toMatchObject({ evidenceRevision: expect.any(Number) });
  }, 60_000);
});
