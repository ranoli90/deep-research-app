import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { getRun } from "../src/modules/runs.js";
import { loadConfig } from "../src/platform/config.js";
import { processRun } from "../src/worker/executor.js";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";

const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const response = (output: unknown) => new Response(JSON.stringify({
  id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
}), { status: 200 });
function searchReply(url: string, content: string) {
  return new Response(JSON.stringify({
    id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{ finish_reason: "stop", message: { annotations: [{ type: "url_citation", url_citation: { url, title: "Study", content } }] } }],
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

describe("user-supplied direct URLs", () => {
  it("reads an explicit url: restriction even when search returns a different host", async () => {
    const question = "What does the vendor spec say about battery life?";
    const direct = "https://vendor.example/spec";
    const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
    const run = await getRun(pool, runId);
    await pool.query(
      `UPDATE research_briefs SET payload = payload || $2::jsonb WHERE id=$1`,
      [run!.brief_id, JSON.stringify({ sourceRestrictions: [`url:${direct}`] })],
    );
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
      OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
      LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
    });
    const readUrls: string[] = [];
    const brief = {
      objective: question, objectiveProvenance: { start: 0, end: question.length, quote: question }, intendedOutput: "explanation",
      criteria: [{
        key: "c0", description: "battery life", field: "battery life", operator: "explain", value: null, unit: null, importance: "hard",
        scope, provenance: { start: question.indexOf("battery"), end: question.indexOf("battery") + "battery life".length, quote: "battery life" },
        group: "g", groupOperator: "all", unresolvedAlternatives: [] as string[],
      }],
      questions: [{ key: "q0", text: "What is the battery life?", criterionKeys: ["c0"], importance: "critical", evidenceStandard: "documented outcomes" }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.plugins?.length) return searchReply("https://search.example/hit", "generic search snippet");
      const ctx = JSON.parse(body.messages[1].content);
      const operation = body.response_format.json_schema.name;
      if (operation === "research_brief_v1") return response(brief);
      if (operation === "research_extract_assertions_v1") {
        const p = ctx.passages[0];
        return response({ candidates: [], assertions: p ? [{ key: "a1", candidateKey: null, criterionKeys: ["c0"], text: p.text, scope, quantities: [], evidence: [{ passageId: p.id, start: 0, end: p.text.length, quote: p.text }] }] : [], limitations: [] });
      }
      if (operation === "research_assess_support_v1") {
        return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [] })) });
      }
      if (operation === "research_review_coverage_v1") {
        return response({ questions: brief.questions.map((q) => ({ questionKey: q.key, status: "answered", assertionKeys: ctx.approvedClaimKeys, reason: "Covered" })), omittedRequirements: [] });
      }
      if (operation === "research_write_report_v1") {
        return response({ title: "Spec", sections: [{ heading: "Answer", paragraphs: [{ text: "The spec is on the vendor page.", claimKeys: ctx.approvedClaimKeys }] }], unresolvedQuestionKeys: [], limitations: [] });
      }
      throw new Error(`unexpected operation:${operation}`);
    }) as typeof fetch;
    vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
      readUrls.push(url);
      return readControl(url, url === direct ? "Vendor spec: battery lasts 18 hours." : "generic search snippet");
    });
    try {
      await processRun(pool, config, runId, {pauseAt:"writing"});
      const before=(await pool.query("SELECT input_digest,ordinal FROM research_iteration_actions WHERE run_id=$1 ORDER BY ordinal",[runId])).rows;
      expect(before.length).toBeGreaterThan(0);
      await processRun(pool, config, runId);
      expect((await pool.query("SELECT input_digest,ordinal FROM research_iteration_actions WHERE run_id=$1 ORDER BY ordinal",[runId])).rows).toEqual(before);
      expect(readUrls, JSON.stringify(readUrls)).toContain(direct);
      const locators = (await pool.query("SELECT canonical_locator FROM sources WHERE run_id=$1 AND account_id=$2", [runId, accountId])).rows.map((r: { canonical_locator: string }) => r.canonical_locator);
      expect(locators).toContain(direct);
      expect(Number((await pool.query("SELECT count(*) AS n FROM research_iteration_actions WHERE run_id=$1",[runId])).rows[0].n)).toBeGreaterThan(0);
    } finally {
      await withTx(pool, (db) => deleteAccount(db, accountId));
    }
  }, 60_000);
});
