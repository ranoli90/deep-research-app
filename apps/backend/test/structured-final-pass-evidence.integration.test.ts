import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createHash } from "node:crypto";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { getRun } from "../src/modules/runs.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { processRun } from "../src/worker/executor.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";

const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

const QUESTION = "How long is the battery life of the Acme Model Z laptop?";
const span = { start: 0, end: QUESTION.length, quote: QUESTION };
const batteryStart = QUESTION.indexOf("battery life");
const batterySpan = { start: batteryStart, end: batteryStart + "battery life".length, quote: "battery life" };
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const brief = {
  objective: QUESTION, objectiveProvenance: span, intendedOutput: "explanation",
  criteria: [{ key: "c1", description: "battery life", field: "battery life", operator: "explain", value: null, unit: null,
    importance: "hard", scope, provenance: batterySpan, group: "g1", groupOperator: "all", unresolvedAlternatives: [] as string[] }],
  questions: [{ key: "q1", text: "How long is the battery life?", criterionKeys: ["c1"], importance: "critical", evidenceStandard: "measured battery tests" }],
  assumptions: [], openAmbiguities: [], explicitExclusions: [],
};

function response(output: unknown) {
  return new Response(JSON.stringify({ id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI",
    usage: { cost: "0.000001" }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }), { status: 200 });
}
function searchReply(url: string) {
  return new Response(JSON.stringify({ id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{ finish_reason: "stop", message: { annotations: [{ type: "url_citation", url_citation: { url, title: "Battery study", content: "Battery findings" } }] } }] }));
}
function readControl(locator: string, text: string): Awaited<ReturnType<typeof sourceReader.readSource>> {
  const bytes = Buffer.from(text), digest = createHash("sha256").update(bytes).digest("hex");
  return { receipt: { requestedUrl: locator, finalUrl: locator, redirectChain: [], status: 200, mime: "text/plain", retrievedAt: new Date().toISOString(), outcome: "successful_body" },
    bytes, extraction: { version: "utf8-notes-v1", digest, status: "partial", warnings: [], blocks: [{ kind: "text", locator: "block:0", text, rows: [] }] } };
}

/** Fabricated transports only: every model op is deterministic and no live provider is contacted. */
function structuredTransport(searches: string[]) {
  return vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.plugins?.length) {
      const url = `https://example.org/battery-${searches.length + 1}`;
      searches.push(url);
      return searchReply(url);
    }
    const context = JSON.parse(body.messages[1].content), operation = body.response_format.json_schema.name;
    if (operation === "research_brief_v1") return response(brief);
    if (operation === "research_extract_assertions_v1") {
      const p = context.passages[0];
      return response({ candidates: [], assertions: p ? [{ key: "a1", candidateKey: null, criterionKeys: ["c1"], text: p.text,
        scope, quantities: [], evidence: [{ passageId: p.id, start: 0, end: p.text.length, quote: p.text }] }] : [], limitations: [] });
    }
    if (operation === "research_assess_support_v1") return response({ assessments: context.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) =>
      ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "Fabricated deterministic control", missingEvidence: [] })) });
    if (operation === "research_review_coverage_v1") return response({ questions: [{ questionKey: "q1", status: "unresolved_at_limit",
      assertionKeys: context.approvedClaimKeys, reason: "More battery evidence remains unresolved" }], omittedRequirements: [] });
    if (operation === "research_write_report_v1") return response({ title: "Battery answer", sections: [{ heading: "Answer",
      paragraphs: context.assertions.filter((a: { key: string }) => context.approvedClaimKeys.includes(a.key)).map((a: { key: string; text: string }) =>
        ({ text: a.text, claimKeys: [a.key] })) }], unresolvedQuestionKeys: ["q1"], limitations: [] });
    throw new Error(`unexpected operation:${operation}`);
  }) as typeof fetch;
}

async function setup() {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(),
    CreateRunRequestSchema.parse({ question: QUESTION, routeMode: "controlled-research" }));
  const sourceId = await insertSource(pool, { accountId, runId, locator: "https://example.org/acme-spec",
    title: "Acme Model Z spec", publisher: "Acme", originCluster: "vendor" });
  const evidenceText = `Acme Model Z battery lasts ${crypto.randomUUID().slice(0, 8)} hours.`;
  await insertVersionAndPassage(pool, { accountId, runId, sourceId, locator: "https://example.org/acme-spec", text: evidenceText, accessLevel: "partial-text" });
  const config: AppConfig = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true", OPENROUTER_API_KEY: "nonbillable-final-pass",
    LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
  return { accountId, runId, evidenceText, config };
}

async function seedExhaustedPasses(runId: string, accountId: string) {
  const taskId = (await pool.query<{ id: string }>("SELECT id FROM research_tasks WHERE run_id=$1", [runId])).rows[0]!.id;
  for (let i = 0; i < 3; i += 1) {
    await pool.query(`INSERT INTO research_iteration_actions(run_id,account_id,brief_revision,task_id,input_digest,ordinal)
      VALUES($1,$2,1,$3,$4,$5)`, [runId, accountId, taskId, createHash("sha256").update(`seed-pass-${i}`).digest("hex"), i]);
  }
}

describe("R14 final exploration pass must not abandon checked evidence", () => {
  it("publishes a limited report from supported evidence instead of failing when the iteration budget is spent", async () => {
    const x = await setup();
    try {
      const searches: string[] = [];
      globalThis.fetch = structuredTransport(searches);
      vi.spyOn(sourceReader, "readSource").mockImplementation(async (locator) => readControl(locator, x.evidenceText));

      // Stop before the local pass loop so a deterministic exhausted budget can be established.
      await processRun(pool, x.config, x.runId, { pauseAt: "researching" });
      expect((await getRun(pool, x.runId))!.phase).toBe("researching");
      await seedExhaustedPasses(x.runId, x.accountId);

      await processRun(pool, x.config, x.runId);

      const run = (await getRun(pool, x.runId))!;
      const events = (await pool.query<{ type: string; payload: { reason?: string } }>(
        "SELECT type,payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'", [x.runId])).rows;
      expect(events.map((e) => e.payload.reason), "the final permitted pass must finish, not exhaust into failure").not.toContain("research_iteration_limit");
      expect(run.terminal_outcome, "a supported limited report must be published").toBe("completed_with_limitations");
      const report = (await pool.query<{ outcome: string; blocks: { text: string }[]; limitations: string[] }>(
        "SELECT outcome,blocks,limitations FROM reports WHERE run_id=$1", [x.runId])).rows[0];
      expect(report).toBeDefined();
      expect(report!.blocks.some((b) => b.text === x.evidenceText), "the checked evidence must appear in the limited report").toBe(true);
      expect(report!.limitations.join(" ")).toMatch(/c1/);
      // Reserving a finishing step means no further public exploration is issued on the final permitted pass.
      expect(searches, "the final permitted pass must not start a new discovery search").toHaveLength(0);
    } finally {
      await deleteAccount(pool, x.accountId);
    }
  }, 60_000);
});
