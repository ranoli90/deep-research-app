import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { CreateRunRequestSchema, investigationFocusFromOutcome, investigationInstruction } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { claimLease, getBrief, getRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { storeAttachment } from "../src/modules/attachments.js";
import { getReportForAccount } from "../src/modules/reports.js";
import { loadConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { buildApp } from "../src/api/app.js";
import { fencedSession } from "../src/worker/fenced-session.js";
import { processRun } from "../src/worker/executor.js";
import { ensureResearchTask } from "../src/worker/research-task.js";
import { extractEvidenceAssertions } from "../src/worker/assertion-extraction.js";
import { executeAssertionSupport } from "../src/worker/support-execution.js";
import { writeResearchReport } from "../src/worker/research-writer.js";
import { runModelVersions } from "../src/modules/run-model-policy.js";
import * as sourceReader from "../src/adapters/retrieval/read-source.js";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const originalFetch = globalThis.fetch;
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };

const LAPTOP = "What did the historical Ardent battery life field note conclude?";
const GPU_TEXT = "The GPU has 16GB VRAM for local AI.";
const BATTERY_TEXT = "The pack lasts 18 hours on a single charge.";
const J11_QUESTION = "Which currently sold US electric cars have EPA range over 300 miles and a starting MSRP under $45,000?";
const J11_RANGE = "The Kia EV6 Wind FWD has an EPA-est. 321-mile driving range.";
const J11_PRICE = "The Kia EV6 starting MSRP is $37,900.";
const J11_SOLD = "The Kia EV6 is currently sold in the US.";
const J11_PASSAGE = `${J11_SOLD} ${J11_RANGE} ${J11_PRICE}`;
const FIRMWARE = "The Ardent recorder supports offline capture only on firmware 4.2.";
const WARRANTY = "Warranty coverage is three years for commercial users.";
const J8_NOTE = `CANARY:SECRET99 private account nightfall\n${FIRMWARE}\n${WARRANTY}`;
const J8_QUESTION = "What firmware and warranty does this historical Ardent field note specify?";

let pool: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;

function response(output: unknown) {
  return new Response(JSON.stringify({
    id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
  }), { status: 200 });
}
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
function outboundQuery(body: { plugins?: unknown[]; messages?: { content?: string }[] }): string | null {
  if (!body.plugins?.length) return null;
  const content = String(body.messages?.[0]?.content ?? body.messages?.[1]?.content ?? "");
  const idx = content.lastIndexOf("Query: ");
  return (idx >= 0 ? content.slice(idx + 7) : content).trim();
}
function workerConfig() {
  return loadConfig({
    DATABASE_URL: TEST_URL, LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
    LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
  });
}
function criterion(question: string, key: string, quote: string) {
  const start = question.toLocaleLowerCase("en").indexOf(quote.toLocaleLowerCase("en"));
  const exact = question.slice(start, start + quote.length);
  return {
    key, description: exact, field: exact, operator: "explain" as const, value: null, unit: null, importance: "hard" as const,
    scope, provenance: { start, end: start + exact.length, quote: exact }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[],
  };
}
function briefFor(question: string, desiredOutcome?: string) {
  const focus = investigationFocusFromOutcome(desiredOutcome);
  const quote = focus && question.toLocaleLowerCase("en").includes(focus.toLocaleLowerCase("en")) ? focus : question;
  const c = criterion(question, "c0", quote);
  return {
    objective: question, objectiveProvenance: { start: 0, end: question.length, quote: question }, intendedOutput: "recommendation",
    criteria: [c],
    questions: [{ key: "q0", text: quote === question ? question : `Investigate ${quote} while keeping the original question.`, criterionKeys: ["c0"], importance: "critical" as const, evidenceStandard: "documented outcomes" }],
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  };
}

beforeAll(async () => {
  pool = createPool(TEST_URL);
  await migrate(pool);
  boss = await createQueue(TEST_URL);
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_URL, APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "true" });
  app = await buildApp({ pool, config, boss });
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => {
  await pool.query(`DELETE FROM pgboss.job WHERE name = 'research-run' AND state IN ('created', 'retry', 'active')`);
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

async function authed() {
  const account = await withTx(pool, async (db) => {
    const s = await createDevSession(db);
    await grantConsent(db, s.accountId);
    return s;
  });
  return account;
}

describe("R-05 deepen and synthetic J8/J11 production paths", () => {
  it("deepens a child that keeps originalQuestion and searches a distinct original-question span", async () => {
    const { token, accountId } = await authed();
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question: LAPTOP, routeMode: "controlled-research" }));
    const config = workerConfig();
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const query = outboundQuery(body);
      if (query != null) {
        const battery = query.trim().toLocaleLowerCase("en") === "battery life";
        return searchReply(battery ? "https://example.org/battery" : "https://example.org/gpu", `${GPU_TEXT} ${BATTERY_TEXT}`);
      }
      const ctx = JSON.parse(body.messages[1].content);
      const operation = body.response_format.json_schema.name;
      if (operation === "research_brief_v1") return response(briefFor(String(ctx.question ?? LAPTOP), ctx.planningState?.desiredOutcome));
      if (operation === "research_extract_assertions_v1") {
        const p = ctx.passages[0];
        if (!p) throw new Error("missing passage");
        const focus = investigationFocusFromOutcome(ctx.planningState?.desiredOutcome);
        const wanted = focus && /battery life/i.test(focus) && p.text.includes(BATTERY_TEXT) ? BATTERY_TEXT : GPU_TEXT;
        const start = p.text.indexOf(wanted);
        if (start < 0) throw new Error(`missing ${wanted}`);
        return response({ candidates: [], assertions: [{ key: "a0", candidateKey: null, criterionKeys: ["c0"], text: wanted, scope, quantities: [], evidence: [{ passageId: p.id, start, end: start + wanted.length, quote: wanted }] }], limitations: [] });
      }
      if (operation === "research_assess_support_v1") {
        return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [] })) });
      }
      if (operation === "research_review_coverage_v1") {
        return response({ questions: ctx.task.questions.map((q: { key: string }) => ({ questionKey: q.key, status: "supported", assertionKeys: ctx.approvedClaimKeys, reason: "Inspected" })), omittedRequirements: [] });
      }
      if (operation === "research_write_report_v1") {
        const assertion = ctx.assertions.find((a: { key: string }) => ctx.approvedClaimKeys.includes(a.key)) ?? ctx.assertions[0];
        return response({ title: "Answer", sections: [{ heading: "Answer", paragraphs: [{ text: assertion.text, claimKeys: [assertion.key] }] }], unresolvedQuestionKeys: [], limitations: [] });
      }
      throw new Error(`unexpected operation:${operation}`);
    }) as typeof fetch;
    vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) =>
      readControl(url, `${GPU_TEXT} ${BATTERY_TEXT}`));
    await processRun(pool, config, runId);
    const parent = (await getRun(pool, runId))!;
    const parentBrief = await getBrief(pool, parent.brief_id);
    const parentQueries = (await pool.query("SELECT query FROM search_operations WHERE run_id=$1 AND query IS NOT NULL", [runId])).rows.map((r: { query: string }) => r.query);
    const parentReport = (await pool.query("SELECT id, blocks FROM reports WHERE run_id=$1", [runId])).rows[0];
    const parentEvents = (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows;
    expect(parent.lifecycle, JSON.stringify({ outcome: parent.terminal_outcome, events: parentEvents, parentQueries })).toBe("terminal");
    expect(parentQueries[0]).toBe(LAPTOP);
    expect(parentQueries[0]).not.toBe("battery life");
    expect(JSON.stringify(parentReport.blocks)).toContain("16GB VRAM");
    expect(JSON.stringify(parentReport.blocks)).not.toContain("18 hours");

    const deepened = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { message: "Go deeper on battery life", expectedBriefRevision: parent.brief_revision },
    });
    expect(deepened.statusCode).toBe(200);
    expect(deepened.json()).toMatchObject({ kind: "deepen", parentRunId: runId, mutatesBrief: false });
    expect(deepened.json().runId).not.toBe(runId);
    expect(deepened.json().verificationId).toBeUndefined();
    const childId = deepened.json().runId as string;
    expect((await pool.query("SELECT verification_required_revision FROM runs WHERE id=$1", [childId])).rows[0].verification_required_revision).toBeNull();
    await processRun(pool, config, childId);
    const child = (await getRun(pool, childId))!;
    const childBrief = await getBrief(pool, child.brief_id);
    const childQueries = (await pool.query("SELECT query FROM search_operations WHERE run_id=$1 AND query IS NOT NULL", [childId])).rows.map((r: { query: string }) => r.query);
    const childReport = (await pool.query("SELECT blocks FROM reports WHERE run_id=$1", [childId])).rows[0];
    const childMeta = { childQueries, events: (await pool.query("SELECT type FROM run_events WHERE run_id=$1 ORDER BY sequence", [childId])).rows, outcome: child.terminal_outcome };
    expect(child.parent_run_id).toBe(runId);
    expect(childBrief.originalQuestion).toBe(LAPTOP);
    expect(parentBrief.originalQuestion).toBe(LAPTOP);
    expect(childBrief.desiredOutcome).toContain(investigationInstruction("battery life"));
    expect(childBrief.assumptions.some((row) => row.value === "Go deeper on battery life")).toBe(false);
    expect(childQueries[0], JSON.stringify(childMeta)).toBe("battery life");
    expect(childQueries[0]).not.toBe(parentQueries[0]);
    expect(JSON.stringify(childReport.blocks), JSON.stringify(childMeta)).toContain("18 hours");
    expect(JSON.stringify(childReport.blocks)).not.toContain("16GB VRAM");
    expect(JSON.stringify(childMeta.events)).not.toMatch(/requested_verification|verification_required/);
    await deleteAccount(pool, accountId);
  }, 90_000);

  it("J8 synthetic attachment publishes from the document and deepen changes extracted evidence", async () => {
    const { token, accountId } = await authed();
    const bytes = Buffer.from(J8_NOTE, "utf8");
    const attachmentId = (await storeAttachment(pool, { accountId, filename: "ardent-note.txt", mime: "text/plain", bytes, extractedText: J8_NOTE }))!;
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({
      question: J8_QUESTION, routeMode: "controlled-research", attachmentIds: [attachmentId],
    }));
    const config = { ...workerConfig(), structuredDiscoveryEnabled: false, liveRetrievalEnabled: false };
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.plugins?.length) expect(JSON.stringify(body)).not.toContain("CANARY:SECRET99");
      const ctx = JSON.parse(body.messages[1].content);
      const operation = body.response_format.json_schema.name;
      if (operation === "research_brief_v1") return response(briefFor(String(ctx.question ?? J8_QUESTION), ctx.planningState?.desiredOutcome));
      if (operation === "research_extract_assertions_v1") {
        const focus = investigationFocusFromOutcome(ctx.planningState?.desiredOutcome);
        const wanted = focus && /warranty/i.test(focus) ? WARRANTY : FIRMWARE;
        const p = ctx.passages.find((row: { text: string }) => row.text.includes(wanted));
        if (!p) throw new Error(`missing ${wanted}`);
        const start = p.text.indexOf(wanted);
        return response({ candidates: [], assertions: [{ key: "a0", candidateKey: null, criterionKeys: ["c0"], text: wanted, scope, quantities: [], evidence: [{ passageId: p.id, start, end: start + wanted.length, quote: wanted }] }], limitations: [] });
      }
      if (operation === "research_assess_support_v1") {
        return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "control", missingEvidence: [] })) });
      }
      if (operation === "research_review_coverage_v1") {
        return response({ questions: ctx.task.questions.map((q: { key: string }) => ({ questionKey: q.key, status: "supported", assertionKeys: ctx.approvedClaimKeys, reason: "Document-grounded" })), omittedRequirements: [] });
      }
      if (operation === "research_write_report_v1") {
        const assertion = ctx.assertions.find((a: { key: string }) => ctx.approvedClaimKeys.includes(a.key)) ?? ctx.assertions[0];
        return response({ title: "Answer", sections: [{ heading: "Answer", paragraphs: [{ text: assertion.text, claimKeys: [assertion.key] }] }], unresolvedQuestionKeys: [], limitations: [] });
      }
      throw new Error(`unexpected operation:${operation}`);
    }) as typeof fetch;
    await processRun(pool, config, runId);
    const parentRun = (await getRun(pool, runId))!;
    const parentReport = (await pool.query("SELECT blocks FROM reports WHERE run_id=$1", [runId])).rows[0];
    const searches = await pool.query("SELECT query FROM search_operations WHERE run_id=$1", [runId]);
    const j8meta = {
      lifecycle: parentRun.lifecycle, outcome: parentRun.terminal_outcome,
      events: (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows,
      passages: (await pool.query("SELECT exact_text FROM passages WHERE run_id=$1", [runId])).rowCount,
    };
    expect(searches.rowCount, JSON.stringify(j8meta)).toBe(0);
    expect(parentReport, JSON.stringify(j8meta)).toBeTruthy();
    expect(JSON.stringify(parentReport.blocks)).toContain("firmware 4.2");
    expect(JSON.stringify(parentReport.blocks)).not.toContain("three years");
    expect(JSON.stringify(parentReport.blocks)).not.toContain("CANARY:SECRET99");
    const parent = (await getRun(pool, runId))!;
    const deepened = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/follow-up`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { message: "Go deeper on warranty", expectedBriefRevision: parent.brief_revision },
    });
    expect(deepened.statusCode).toBe(200);
    expect(deepened.json().kind).toBe("deepen");
    const childId = deepened.json().runId as string;
    await processRun(pool, config, childId);
    const childBrief = await getBrief(pool, (await getRun(pool, childId))!.brief_id);
    const childReport = (await pool.query("SELECT blocks FROM reports WHERE run_id=$1", [childId])).rows[0];
    expect(childBrief.originalQuestion).toBe(J8_QUESTION);
    expect(childBrief.desiredOutcome).toContain(investigationInstruction("warranty"));
    expect(JSON.stringify(childReport.blocks)).toContain("three years");
    expect(JSON.stringify(childReport.blocks)).not.toContain("firmware 4.2");
    expect((await pool.query("SELECT query FROM search_operations WHERE run_id=$1", [childId])).rowCount).toBe(0);
    const intents = await pool.query("SELECT request_digest FROM provider_intents WHERE run_id=ANY($1::uuid[])", [[runId, childId]]);
    expect(intents.rows.some((r: { request_digest: string }) => (r.request_digest ?? "").includes("CANARY:SECRET99"))).toBe(false);
    await deleteAccount(pool, accountId);
  }, 90_000);

  it("J11 hierarchical writer publishes owned range and price without unquoted eligibility arithmetic", async () => {
    const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question: J11_QUESTION, routeMode: "controlled-research" }));
    const owner = crypto.randomUUID();
    const fence = (await claimLease(pool, runId, owner, 30_000))!;
    const session = fencedSession(pool, { runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30_000 });
    const config = { ...workerConfig(), structuredDiscoveryEnabled: false, liveRetrievalEnabled: false };
    const rangeC = criterion(J11_QUESTION, "range", "EPA range over 300 miles");
    const priceC = criterion(J11_QUESTION, "price", "starting MSRP under $45,000");
    const soldC = criterion(J11_QUESTION, "sold", "currently sold US");
    const taskBrief = {
      objective: J11_QUESTION, objectiveProvenance: { start: 0, end: J11_QUESTION.length, quote: J11_QUESTION }, intendedOutput: "comparison" as const,
      criteria: [rangeC, priceC, soldC],
      questions: [
        { key: "q_range", text: "Which currently sold US electric cars have EPA range over 300 miles?", criterionKeys: ["range"], importance: "critical" as const, evidenceStandard: "manufacturer EPA figures" },
        { key: "q_price", text: "Which of those have a starting MSRP under $45,000?", criterionKeys: ["price"], importance: "critical" as const, evidenceStandard: "manufacturer MSRP" },
        { key: "q_sold", text: "Which of those are currently sold in the US?", criterionKeys: ["sold"], importance: "useful" as const, evidenceStandard: "current US retail" },
      ],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    try {
      globalThis.fetch = vi.fn(async () => response(taskBrief)) as typeof fetch;
      const task = await ensureResearchTask(pool, config, session, { runId, accountId, fence, briefRevision: 1 });
      if (task.kind !== "task") throw new Error("task missing");
      expect(task.task.specification.questions.map((q) => q.key)).toEqual(["q_range", "q_price", "q_sold"]);
      expect(task.task.specification.intendedOutput).toBe("comparison");
      const sourceId = await insertSource(pool, { accountId, runId, locator: "https://example.org/kia-ev6", title: "Kia EV6", publisher: "Kia", originCluster: "kia" });
      const passage = await insertVersionAndPassage(pool, { sourceId, accountId, runId, locator: "https://example.org/kia-ev6", text: J11_PASSAGE, accessLevel: "partial-text" });
      const quote = (text: string) => ({ passageId: passage.passageId, start: J11_PASSAGE.indexOf(text), end: J11_PASSAGE.indexOf(text) + text.length, quote: text });
      const assertions = [
        { key: "range", candidateKey: null, criterionKeys: ["range"], text: J11_RANGE, scope, quantities: [], evidence: [quote(J11_RANGE)] },
        { key: "price", candidateKey: null, criterionKeys: ["price"], text: J11_PRICE, scope, quantities: [], evidence: [quote(J11_PRICE)] },
        { key: "sold", candidateKey: null, criterionKeys: ["sold"], text: J11_SOLD, scope, quantities: [], evidence: [quote(J11_SOLD)] },
      ];
      globalThis.fetch = vi.fn(async () => response({ candidates: [{ key: "kia_ev6", label: "Kia EV6", evidence: [quote(J11_SOLD)] }], assertions, limitations: [] })) as typeof fetch;
      const extraction = await extractEvidenceAssertions(pool, config, session, { runId, accountId, fence, briefRevision: 1, taskId: task.task.id, passageIds: [passage.passageId] });
      if (extraction.kind !== "extraction") throw new Error(JSON.stringify(extraction));
      globalThis.fetch = vi.fn(async () => response({
        assessments: assertions.map((a) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "Owned quote", missingEvidence: [] })),
      })) as typeof fetch;
      const support = await executeAssertionSupport(pool, config, session, { runId, accountId, fence, briefRevision: 1, taskId: task.task.id, extractionIntentId: extraction.intentId });
      if (support.kind !== "support") throw new Error(JSON.stringify(support));
      const seen: string[] = [];
      globalThis.fetch = vi.fn(async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        const name = request.response_format.json_schema.name;
        const ctx = JSON.parse(request.messages[1].content);
        if (name === "research_write_report_v1") {
          seen.push(`${ctx.sectionWrite?.questionKey}:${ctx.approvedClaimKeys.join(",")}`);
          const keys: string[] = ctx.approvedClaimKeys;
          const paragraphs = keys.flatMap((key) => {
            const assertion = assertions.find((a) => a.key === key);
            return assertion ? [{ text: assertion.text, claimKeys: [key] }] : [];
          });
          return response({ title: "Answer", sections: [{ heading: ctx.sectionWrite?.heading ?? "Answer", paragraphs }], unresolvedQuestionKeys: [], limitations: [] });
        }
        if (name === "research_review_coverage_v1") {
          return response({ questions: ctx.task.questions.map((q: { key: string }) => ({ questionKey: q.key, status: "supported", assertionKeys: ctx.approvedClaimKeys, reason: "Owned quotes" })), omittedRequirements: [] });
        }
        if (name === "research_assess_support_v1") {
          return response({ assessments: ctx.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "Owned quotes", missingEvidence: [] })) });
        }
        throw new Error(`unexpected operation:${name}`);
      }) as typeof fetch;
      const published = await writeResearchReport(pool, config, session, {
        runId, accountId, fence, briefRevision: 1, taskId: task.task.id,
        extractionIntentId: extraction.intentId, sourceSupportIntentId: support.intentId,
      });
      expect(published).toMatchObject({ kind: "publication", accepted: true });
      if (published.kind !== "publication" || !published.reportId) throw new Error(JSON.stringify(published));
      const report = await getReportForAccount(pool, published.reportId, accountId);
      const texts = report.blocks.map((b: { kind: string; text: string }) => `${b.kind}:${b.text}`);
      const composition = (await pool.query("SELECT composition FROM research_drafts WHERE run_id=$1", [runId])).rows[0]?.composition;
      const writes = await pool.query("SELECT input_manifest FROM model_operation_results WHERE run_id=$1 AND operation='write_report' ORDER BY created_at", [runId]);
      const j11meta = { seen, composition, writeCount: writes.rows.length, texts, specQuestions: task.task.specification.questions.map((q) => q.key) };
      expect(writes.rows.length, JSON.stringify(j11meta)).toBeGreaterThanOrEqual(3);
      expect(composition?.sections?.length ?? 0, JSON.stringify(j11meta)).toBeGreaterThanOrEqual(3);
      expect(seen.some((row) => row.includes("q_range") || row.startsWith("q_range:")), JSON.stringify(j11meta)).toBe(true);
      expect(seen.some((row) => row.includes("q_price") || row.startsWith("q_price:")), JSON.stringify(j11meta)).toBe(true);
      expect(texts.some((t: string) => t.includes(J11_RANGE)), JSON.stringify(j11meta)).toBe(true);
      expect(texts.some((t: string) => t.includes(J11_PRICE))).toBe(true);
      expect(texts.some((t: string) => t.includes("321-mile"))).toBe(true);
      expect(texts.some((t: string) => t.includes("$37,900"))).toBe(true);
      expect(texts.filter((t: string) => t.startsWith("caveat:") && /321-mile|\$37,900/.test(t))).toEqual([]);
      expect(texts.some((t: string) => /meets the requirement of having an EPA range over 300/.test(t))).toBe(false);
      expect(texts.some((t: string) => /which is under the specified limit of \$45,000/.test(t))).toBe(false);
      expect(writes.rows.every((row: { input_manifest: { version?: string; sectionWrite?: { questionKey?: string } } }) => row.input_manifest.version === "model-input.v8")).toBe(true);
      expect(writes.rows.some((row: { input_manifest: { sectionWrite?: { questionKey?: string } } }) => row.input_manifest.sectionWrite?.questionKey === "q_range")).toBe(true);
      expect(await runModelVersions(pool, runId)).toMatchObject({ policyId: expect.any(String) });
    } finally {
      session.stop();
      await deleteAccount(pool, accountId);
    }
  }, 90_000);
});
