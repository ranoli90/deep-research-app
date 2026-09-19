import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CorrectionRequestSchema, CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitResearchCorrection } from "../src/modules/research-corrections.js";
import { getRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
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

async function runCase(
  question: string,
  test: (x: { runId: string; accountId: string; config: ReturnType<typeof loadConfig> }) => Promise<void>,
) {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
  const config = loadConfig({
    DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
    LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
  });
  try { await test({ runId, accountId, config }); }
  finally { await withTx(pool, (db) => deleteAccount(db, accountId)); }
}

function criterion(question: string, key: string, quote: string) {
  const start = question.indexOf(quote);
  return {
    key, description: quote, field: quote, operator: "explain" as const, value: null, unit: null, importance: "hard" as const,
    scope, provenance: { start, end: start + quote.length, quote }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[],
  };
}

describe("Wave 5 production intelligence persistence", () => {
  it("reconstructs discovery queries after a crash so query 2 is not re-issued as new", async () => {
    const question = "Compare export and offline editing.";
    await runCase(question, async (x) => {
      const c0 = criterion(question, "c0", "export");
      const c1 = criterion(question, "c1", "offline editing");
      const brief = {
        objective: question, objectiveProvenance: { start: 0, end: question.length, quote: question }, intendedOutput: "comparison",
        criteria: [c0, c1],
        questions: [
          { key: "q0", text: "Does it export?", criterionKeys: ["c0"], importance: "critical", evidenceStandard: "documented outcomes" },
          { key: "q1", text: "Does it edit offline?", criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" },
        ],
        assumptions: [], openAmbiguities: [], explicitExclusions: [],
      };
      let pluginCalls = 0;
      let crashAtThird = true;
      const queriesSent: string[] = [];
      globalThis.fetch = vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.plugins?.length) {
          pluginCalls += 1;
          const query = String(body.messages[1].content);
          queriesSent.push(query);
          return searchReply(`https://example.org/${encodeURIComponent(query)}`, `${query} findings`);
        }
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
          return response({ questions: brief.questions.map((q) => ({ questionKey: q.key, status: "unresolved_at_limit", assertionKeys: ctx.approvedClaimKeys, reason: "Still unresolved" })), omittedRequirements: [] });
        }
        if (operation === "research_write_report_v1") {
          return response({ title: "Findings", sections: [{ heading: "Evidence", paragraphs: [{ text: "Limited.", claimKeys: ctx.approvedClaimKeys }] }], unresolvedQuestionKeys: ["q0", "q1"], limitations: [] });
        }
        throw new Error(`unexpected operation:${operation}`);
      }) as typeof fetch;
      vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
        if (crashAtThird && pluginCalls >= 2) throw new Error("injected_crash_after_query_2");
        return readControl(url, "Export and offline editing are supported.");
      });
      const first = processRun(pool, x.config, x.runId);
      const firstOutcome = await first.then(() => "resolved").catch((e: Error) => e.message);
      const firstMeta = { firstOutcome, pluginCalls, queriesSent, terminal: (await getRun(pool, x.runId))?.terminal_outcome,
        events: (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [x.runId])).rows };
      expect(firstOutcome, JSON.stringify(firstMeta)).toBe("injected_crash_after_query_2");
      const afterCrash = (await pool.query(
        `SELECT s.query FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id
          WHERE s.run_id=$1 AND s.query IS NOT NULL ORDER BY i.created_at, s.intent_id`,
        [x.runId],
      )).rows.map((r: { query: string }) => r.query);
      expect(afterCrash, JSON.stringify({ afterCrash, queriesSent })).toHaveLength(2);
      expect(afterCrash[0]).toBe(question);
      expect(afterCrash[1]).toBe("export");
      const needsAfterCrash = (await pool.query(
        `SELECT need_id, state, criterion_key, next_action FROM research_evidence_needs WHERE run_id=$1 ORDER BY need_id`,
        [x.runId],
      )).rows as { need_id: string; state: string; criterion_key: string | null; next_action: { kind?: string; queryHint?: string } }[];
      expect(needsAfterCrash.map((r) => r.need_id).sort(), JSON.stringify(needsAfterCrash)).toEqual(["need-c0", "need-c1"]);
      expect(needsAfterCrash.every((r) => r.state === "missing" || r.state === "partial")).toBe(true);
      const crashHints = needsAfterCrash.map((r) => r.next_action?.queryHint).filter(Boolean) as string[];
      expect(new Set(crashHints).size).toBeGreaterThan(1);
      await pool.query("UPDATE run_leases SET expires_at=now()-interval '1 second' WHERE run_id=$1", [x.runId]);
      crashAtThird = false;
      await processRun(pool, x.config, x.runId);
      const afterRestart = (await pool.query(
        `SELECT s.query FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id
          WHERE s.run_id=$1 AND s.query IS NOT NULL ORDER BY i.created_at, s.intent_id`,
        [x.runId],
      )).rows.map((r: { query: string }) => r.query);
      expect(afterRestart.filter((q: string) => q === "export")).toHaveLength(1);
      expect(afterRestart[0]).toBe(question);
      expect(afterRestart.length, JSON.stringify(afterRestart)).toBeGreaterThanOrEqual(3);
      expect(afterRestart[2]).not.toBe("export");
      expect(afterRestart[2]).not.toBe(question);
      const needsAfterRestart = (await pool.query(
        `SELECT need_id, state, next_action FROM research_evidence_needs WHERE run_id=$1 ORDER BY need_id`,
        [x.runId],
      )).rows as { need_id: string; state: string; next_action: { kind?: string; queryHint?: string } }[];
      expect(needsAfterRestart.map((r) => r.need_id).sort()).toEqual(["need-c0", "need-c1"]);
      for (const prior of needsAfterCrash) {
        const again = needsAfterRestart.find((r) => r.need_id === prior.need_id);
        expect(again?.next_action?.queryHint, JSON.stringify({ prior, again })).toBe(prior.next_action?.queryHint);
      }
    });
  }, 60_000);

  it("persists purchase candidates with exclusion evidence and reopens them after a relaxed budget", async () => {
    const question = "best laptop for running AI under $2000 in the United States";
    await runCase(question, async (x) => {
      const framework = "Framework Laptop costs 1999 USD in the United States.";
      const dell = "Dell Precision costs 2500 USD in the United States.";
      const frameworkSource = await insertSource(pool, { accountId: x.accountId, runId: x.runId, locator: "https://example.org/framework", title: "Framework", publisher: "Vendor", originCluster: "framework" });
      await insertVersionAndPassage(pool, { sourceId: frameworkSource, accountId: x.accountId, runId: x.runId, locator: "https://example.org/framework", text: framework, accessLevel: "partial-text" });
      const dellSource = await insertSource(pool, { accountId: x.accountId, runId: x.runId, locator: "https://example.org/dell", title: "Dell", publisher: "Vendor", originCluster: "dell" });
      await insertVersionAndPassage(pool, { sourceId: dellSource, accountId: x.accountId, runId: x.runId, locator: "https://example.org/dell", text: dell, accessLevel: "partial-text" });
      const span = { start: 0, end: question.length, quote: question };
      const brief = {
        objective: question, objectiveProvenance: span, intendedOutput: "recommendation",
        criteria: [{ key: "c1", description: "budget", field: "budget", operator: "compare", value: null, unit: null, importance: "hard", scope, provenance: span, group: "g1", groupOperator: "all", unresolvedAlternatives: [] }],
        questions: [{ key: "q1", text: question, criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" }],
        assumptions: [], openAmbiguities: [], explicitExclusions: [],
      };
      globalThis.fetch = vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.plugins?.length) return searchReply("https://example.org/other", "Acer Aspire costs 2800 USD in the United States.");
        const ctx = JSON.parse(body.messages[1].content);
        const operation = body.response_format.json_schema.name;
        if (operation === "research_brief_v1") {
          const q = String(ctx.question ?? question);
          const qSpan = { start: 0, end: q.length, quote: q };
          return response({
            ...brief,
            objective: q,
            objectiveProvenance: qSpan,
            criteria: [{ ...brief.criteria[0]!, provenance: qSpan }],
            questions: [{ ...brief.questions[0]!, text: q }],
          });
        }
        if (operation === "research_extract_assertions_v1") {
          return response({
            candidates: [],
            assertions: ctx.passages.map((p: { id: string; text: string }, i: number) => ({
              key: `a${i}`, candidateKey: null, criterionKeys: ["c1"], text: p.text, scope,
              quantities: [], evidence: [{ passageId: p.id, start: 0, end: p.text.length, quote: p.text }],
            })),
            limitations: [],
          });
        }
        if (operation === "research_assess_support_v1") {
          return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [] })) });
        }
        if (operation === "research_review_coverage_v1") {
          return response({ questions: [{ questionKey: "q1", status: "supported", assertionKeys: ctx.approvedClaimKeys, reason: "Inspected" }], omittedRequirements: [] });
        }
        if (operation === "research_write_report_v1") {
          return response({ title: "Laptops", sections: [{ heading: "Answer", paragraphs: ctx.assertions.filter((a: { key: string }) => ctx.approvedClaimKeys.includes(a.key)).map((a: { key: string; text: string }) => ({ text: a.text, claimKeys: [a.key] })) }], unresolvedQuestionKeys: [], limitations: [] });
        }
        throw new Error(`unexpected operation:${operation}`);
      }) as typeof fetch;
      await processRun(pool, { ...x.config, structuredDiscoveryEnabled: false, liveRetrievalEnabled: false, structuredChallengeEnabled: false }, x.runId);
      const parent = (await pool.query("SELECT identity, status, excluded_by, exclusion_evidence, feasibility FROM candidates WHERE run_id=$1 AND candidate_key IS NOT NULL ORDER BY identity", [x.runId])).rows;
      const parentMeta = { terminal: (await getRun(pool, x.runId))?.terminal_outcome, events: (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [x.runId])).rows, parent };
      expect(parent.some((r: { identity: string; status: string }) => /Dell/i.test(r.identity) && r.status === "excluded"), JSON.stringify(parentMeta)).toBe(true);
      expect(parent.some((r: { identity: string; exclusion_evidence: string | null; excluded_by: string | null }) => /Dell/i.test(r.identity) && String(r.exclusion_evidence ?? r.excluded_by ?? "").includes("budget"))).toBe(true);
      expect(parent.some((r: { identity: string }) => /Framework/i.test(r.identity))).toBe(true);
      const child = await admitResearchCorrection(pool, x.accountId, x.runId, CorrectionRequestSchema.parse({
        expectedBriefRevision: 1, correctionText: "Raise the budget",
        patch: { kind: "replace_question", question: "best laptop for running AI under $3000 in the United States", evidencePolicy: "reuse_snapshot" },
      }));
      const acerSource = await insertSource(pool, { accountId: x.accountId, runId: child.runId, locator: "https://example.org/acer", title: "Acer", publisher: "Vendor", originCluster: "acer" });
      await insertVersionAndPassage(pool, { sourceId: acerSource, accountId: x.accountId, runId: child.runId, locator: "https://example.org/acer", text: "Acer Aspire costs 2800 USD in the United States.", accessLevel: "partial-text" });
      vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) =>
        readControl(url, "Acer Aspire costs 2800 USD in the United States. Framework Laptop costs 1999 USD in the United States. Dell Precision costs 2500 USD in the United States."));
      await processRun(pool, { ...x.config, structuredDiscoveryEnabled: true, liveRetrievalEnabled: true, structuredChallengeEnabled: false }, child.runId);
      const childRows = (await pool.query("SELECT identity, status, feasibility FROM candidates WHERE run_id=$1 AND candidate_key IS NOT NULL ORDER BY identity", [child.runId])).rows;
      const childMeta = { terminal: (await getRun(pool, child.runId))?.terminal_outcome, events: (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [child.runId])).rows, childRows };
      expect(childRows.some((r: { identity: string; status: string }) => /Dell/i.test(r.identity) && r.status !== "excluded"), JSON.stringify(childMeta)).toBe(true);
      expect(childRows.some((r: { identity: string }) => /Acer/i.test(r.identity))).toBe(true);
    });
  }, 60_000);

  it("creates independent challenge state for two consequential conclusions", async () => {
    const question = "Compare export and offline editing.";
    await runCase(question, async (x) => {
      const exportText = "WidgetOne: export is supported.";
      const offlineText = "WidgetOne: offline editing is supported.";
      const s1 = await insertSource(pool, { accountId: x.accountId, runId: x.runId, locator: "https://example.org/export", title: "Export", publisher: "Vendor", originCluster: "export" });
      await insertVersionAndPassage(pool, { sourceId: s1, accountId: x.accountId, runId: x.runId, locator: "https://example.org/export", text: exportText, accessLevel: "partial-text" });
      const s2 = await insertSource(pool, { accountId: x.accountId, runId: x.runId, locator: "https://example.org/offline", title: "Offline", publisher: "Vendor", originCluster: "offline" });
      await insertVersionAndPassage(pool, { sourceId: s2, accountId: x.accountId, runId: x.runId, locator: "https://example.org/offline", text: offlineText, accessLevel: "partial-text" });
      const c0 = criterion(question, "c0", "export");
      const c1 = criterion(question, "c1", "offline editing");
      const brief = {
        objective: question, objectiveProvenance: { start: 0, end: question.length, quote: question }, intendedOutput: "comparison",
        criteria: [c0, c1],
        questions: [
          { key: "q0", text: "Does it export?", criterionKeys: ["c0"], importance: "critical", evidenceStandard: "documented outcomes" },
          { key: "q1", text: "Does it edit offline?", criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" },
        ],
        assumptions: [], openAmbiguities: [], explicitExclusions: [],
      };
      globalThis.fetch = vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.plugins?.length) return searchReply("https://example.org/challenge", "WidgetOne: export is supported. WidgetOne: offline editing is supported.");
        const ctx = JSON.parse(body.messages[1].content);
        const operation = body.response_format.json_schema.name;
        if (operation === "research_brief_v1") return response(brief);
        if (operation === "research_extract_assertions_v1") {
          const exportP = ctx.passages.find((p: { text: string }) => p.text.includes("export is supported"));
          const offlineP = ctx.passages.find((p: { text: string }) => p.text.includes("offline editing is supported"));
          const assertions = [];
          if (exportP) assertions.push({ key: "export", candidateKey: null, criterionKeys: ["c0"], text: exportP.text, scope, quantities: [], evidence: [{ passageId: exportP.id, start: 0, end: exportP.text.length, quote: exportP.text }] });
          if (offlineP) assertions.push({ key: "offline", candidateKey: null, criterionKeys: ["c1"], text: offlineP.text, scope, quantities: [], evidence: [{ passageId: offlineP.id, start: 0, end: offlineP.text.length, quote: offlineP.text }] });
          return response({ candidates: [], assertions, limitations: [] });
        }
        if (operation === "research_assess_support_v1") {
          return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [] })) });
        }
        if (operation === "research_review_coverage_v1") {
          return response({ questions: brief.questions.map((q) => ({ questionKey: q.key, status: "supported", assertionKeys: ctx.approvedClaimKeys, reason: "Inspected" })), omittedRequirements: [] });
        }
        if (operation === "research_write_report_v1") {
          return response({ title: "Findings", sections: [{ heading: "Answer", paragraphs: ctx.assertions.filter((a: { key: string }) => ctx.approvedClaimKeys.includes(a.key)).map((a: { key: string; text: string }) => ({ text: a.text, claimKeys: [a.key] })) }], unresolvedQuestionKeys: [], limitations: [] });
        }
        throw new Error(`unexpected operation:${operation}`);
      }) as typeof fetch;
      vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => readControl(url, "WidgetOne: export is supported. WidgetOne: offline editing is supported."));
      await processRun(pool, { ...x.config, structuredChallengeEnabled: true }, x.runId);
      const rows = (await pool.query(
        "SELECT conclusion_key, state, challenged, outcome FROM conclusion_challenges WHERE run_id=$1 ORDER BY conclusion_key",
        [x.runId],
      )).rows;
      expect(rows.length, JSON.stringify({ rows, outcome: (await getRun(pool, x.runId))?.terminal_outcome })).toBeGreaterThanOrEqual(2);
      expect(new Set(rows.map((r: { conclusion_key: string }) => r.conclusion_key)).size).toBeGreaterThanOrEqual(2);
      expect(rows.filter((r: { challenged: boolean; state: string }) => r.challenged || r.state === "challenged" || r.state === "blocked" || r.state === "unknown").length).toBeGreaterThanOrEqual(2);
    });
  }, 60_000);
});
