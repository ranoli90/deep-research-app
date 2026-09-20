/** Fabricated model/search/reader controls. Proves the production worker stops extra discovery on a cited founding-year fact. */
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { getLatestReportForRun } from "../src/modules/reports.js";
import { getRun } from "../src/modules/runs.js";
import { loadConfig } from "../src/platform/config.js";
import { processRun } from "../src/worker/executor.js";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("Explicit isolated test database required");

const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(testDatabaseUrl);
  await migrate(pool);
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const response = (output: unknown) => new Response(JSON.stringify({
  id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
}), { status: 200 });

function searchEight() {
  return new Response(JSON.stringify({
    id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{
      finish_reason: "stop",
      message: {
        annotations: Array.from({ length: 8 }, (_, i) => ({
          type: "url_citation",
          url_citation: {
            url: `https://source${i}.example/taco-bell-${i}`,
            title: `Taco Bell history source ${i}`,
            content: `Taco Bell was founded in 1962. Page dated 2015-03-01. Independent write-up ${i}.`,
          },
        })),
      },
    }],
  }));
}

function readControl(locator: string, text: string): Awaited<ReturnType<typeof sourceReader.readSource>> {
  const bytes = Buffer.from(text), digest = createHash("sha256").update(bytes).digest("hex");
  return {
    receipt: { requestedUrl: locator, finalUrl: locator, redirectChain: [], status: 200, mime: "text/plain", retrievedAt: new Date().toISOString(), outcome: "successful_body" },
    bytes,
    extraction: { version: "utf8-notes-v1", digest, status: "partial", warnings: [], blocks: [{ kind: "text", locator: "block:0", text, rows: [] }] },
  };
}

describe("simple historical public-fact discovery", () => {
  it("stops after supported founding-year evidence even when coverage claims generic freshness is unmet", async () => {
    const question = "when was Taco Bell founded";
    const accountId = await withTx(pool, async (db) => {
      const s = await createDevSession(db);
      await grantConsent(db, s.accountId);
      return s.accountId;
    });
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
    const config = loadConfig({
      DATABASE_URL: testDatabaseUrl, LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
      OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
      LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
    });
    const span = { start: 0, end: question.length, quote: question };
    const foundedAt = question.indexOf("founded");
    const brief = {
      objective: question, objectiveProvenance: span, intendedOutput: "answer",
      criteria: [{
        key: "c0", description: "founded", field: "founded", operator: "explain" as const, value: null, unit: null, importance: "hard" as const,
        scope, provenance: { start: foundedAt, end: foundedAt + "founded".length, quote: "founded" },
        group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[],
      }],
      questions: [{ key: "q0", text: question, criterionKeys: ["c0"], importance: "critical", evidenceStandard: "documented outcomes" }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    let pluginCalls = 0;
    const operations: string[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.plugins?.length) {
        pluginCalls += 1;
        return searchEight();
      }
      const ctx = JSON.parse(body.messages[1].content);
      const operation = body.response_format.json_schema.name;
      operations.push(operation);
      if (operation === "research_brief_v1") return response(brief);
      if (operation === "research_extract_assertions_v1") {
        const p = ctx.passages.find((row: { text: string }) => /founded in 1962/i.test(row.text)) ?? ctx.passages[0];
        return response({
          candidates: [],
          assertions: p ? [{
            key: "a1", candidateKey: null, criterionKeys: ["c0"], text: p.text, scope, quantities: [],
            evidence: [{ passageId: p.id, start: 0, end: p.text.length, quote: p.text }],
          }] : [],
          limitations: [],
        });
      }
      if (operation === "research_assess_support_v1") {
        return response({
          assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({
            claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [],
          })),
        });
      }
      if (operation === "research_review_coverage_v1") {
        return response({
          questions: [{
            questionKey: "q0",
            status: "unresolved_at_limit",
            assertionKeys: ctx.approvedClaimKeys,
            reason: "Sources are older than one year; a fresher page is required for the founding date.",
          }],
          omittedRequirements: [],
        });
      }
      if (operation === "research_write_report_v1") {
        return response({
          title: "Taco Bell founding",
          sections: [{ heading: "Answer", paragraphs: [{ text: "Taco Bell was founded in 1962.", claimKeys: ctx.approvedClaimKeys }] }],
          unresolvedQuestionKeys: [],
          limitations: ["Some requested questions remain unresolved."],
        });
      }
      throw new Error(`unexpected operation:${operation}`);
    }) as typeof fetch;
    const readUrls: string[] = [];
    vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
      readUrls.push(url);
      return readControl(url, "Taco Bell was founded in 1962.");
    });
    try {
      await processRun(pool, { ...config, structuredChallengeEnabled: false }, runId);
      const events = (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows;
      const searches = (await pool.query(
        `SELECT s.query FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.run_id=$1 ORDER BY i.created_at`,
        [runId],
      )).rows as { query: string }[];
      const reads = Number((await pool.query(
        "SELECT count(*)::int AS n FROM source_read_operations WHERE run_id=$1 AND state='finished'",
        [runId],
      )).rows[0]?.n ?? 0);
      const report = await getLatestReportForRun(pool, runId, accountId);
      const terminal = (await getRun(pool, runId))?.terminal_outcome;
      const meta = { pluginCalls, searches, reads, readUrls, operations, terminal, events: events.map((e: { type: string }) => e.type) };
      expect(pluginCalls, JSON.stringify(meta)).toBe(1);
      expect(searches, JSON.stringify(meta)).toHaveLength(1);
      expect(searches[0]?.query).toBe(question);
      expect(readUrls.length, JSON.stringify(meta)).toBeLessThan(8);
      expect(reads, JSON.stringify(meta)).toBeGreaterThanOrEqual(2);
      expect(reads, JSON.stringify(meta)).toBeLessThan(8);
      expect(report, JSON.stringify(meta)).toBeTruthy();
      expect(["completed", "completed_with_limitations"]).toContain(terminal);
    } finally {
      await withTx(pool, (db) => deleteAccount(db, accountId));
    }
  }, 60_000);
});
