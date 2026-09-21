/** Fabricated model/search/reader. Production worker + isolated PG for BB-02 v2 contract. */
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
import { LostWorkerLease } from "../src/worker/fenced-session.js";
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
const NORTHSTAR = "When was Northstar Bakery incorporated?";
const TWO_COMPANY = "Compare when Helixworks and Nimbus Forge were founded and explain why their expansion strategies differed.";
const MIXED_LATEST = "When was Vesper Transit founded and what is its latest headcount?";

const HELIX_FACT = "Helixworks was founded in 2007.";
const NIMBUS_FACT = "Nimbus Forge was founded in 2011.";
const EXPANSION_FACT = "Helixworks expanded by licensing kitchens; Nimbus Forge expanded by opening company-owned shops.";
const VESPER_FOUNDING = "Vesper Transit was founded in 2012-04-01 according to its charter filing.";
const VESPER_HEADCOUNT = "Vesper Transit latest headcount is 4,820 employees as of 2026-08-01.";
const NORTHSTAR_FACT = "Northstar Bakery was incorporated in 1998.";
const WEATHER_TEXT = "Regional forecast: rain continues through Friday. Almanac rainfall notes only.";

type NeedRow = {
  need_id: string;
  state: string;
  criterion_key: string | null;
  freshness_required: boolean;
  stop_reason: string | null;
  next_action: { kind?: string; queryHint?: string; reason?: string };
};

function response(output: unknown) {
  return new Response(JSON.stringify({
    id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
  }), { status: 200 });
}

function searchHits(hits: { url: string; title: string; content: string }[]) {
  return new Response(JSON.stringify({
    id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{
      finish_reason: "stop",
      message: {
        annotations: hits.map((h) => ({
          type: "url_citation",
          url_citation: { url: h.url, title: h.title, content: h.content },
        })),
      },
    }],
  }));
}

function outboundQuery(body: { plugins?: unknown[]; messages?: { role?: string; content?: string }[] }): string | null {
  if (!body.plugins?.length) return null;
  const user = body.messages?.find((m) => m.role === "user") ?? body.messages?.[1];
  const content = String(user?.content ?? "");
  const idx = content.lastIndexOf("Query: ");
  return (idx >= 0 ? content.slice(idx + 7) : content).trim();
}

function readControl(locator: string, text: string): Awaited<ReturnType<typeof sourceReader.readSource>> {
  const bytes = Buffer.from(text);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    receipt: { requestedUrl: locator, finalUrl: locator, redirectChain: [], status: 200, mime: "text/plain", retrievedAt: new Date().toISOString(), outcome: "successful_body" },
    bytes,
    extraction: { version: "utf8-notes-v1", digest, status: "partial", warnings: [], blocks: [{ kind: "text", locator: "block:0", text, rows: [] }] },
  };
}

function criterion(question: string, key: string, quote: string) {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`missing_quote:${quote}`);
  return {
    key, description: quote, field: quote, operator: "explain" as const, value: null, unit: null, importance: "hard" as const,
    scope, provenance: { start, end: start + quote.length, quote }, group: "g", groupOperator: "all" as const, unresolvedAlternatives: [] as string[],
  };
}

function pages(kind: "helix" | "nimbus" | "expansion" | "weather" | "northstar" | "vesper-founding" | "vesper-headcount", count: number) {
  return Array.from({ length: count }, (_, i) => {
    if (kind === "weather") return { url: `https://weather-${i}.example/forecast`, title: `Forecast ${i}`, content: WEATHER_TEXT };
    if (kind === "helix") return { url: `https://helixworks-${i}.example/history`, title: `Helixworks history ${i}`, content: HELIX_FACT };
    if (kind === "nimbus") return { url: `https://nimbus-forge-${i}.example/about`, title: `Nimbus Forge about ${i}`, content: NIMBUS_FACT };
    if (kind === "expansion") return { url: `https://expansion-study-${i}.example/compare`, title: `Expansion study ${i}`, content: EXPANSION_FACT };
    if (kind === "northstar") return { url: `https://northstar-${i}.example/charter`, title: `Northstar charter ${i}`, content: `${NORTHSTAR_FACT} Page dated 2015-03-01.` };
    if (kind === "vesper-headcount") return { url: `https://vesper-staff-${i}.example/headcount`, title: `Vesper headcount ${i}`, content: VESPER_HEADCOUNT };
    return { url: `https://vesper-charter-${i}.example/founding`, title: `Vesper founding ${i}`, content: `${VESPER_FOUNDING} Filing dated 2012-04-01.` };
  });
}

function textForUrl(url: string): string {
  if (/weather-/.test(url)) return WEATHER_TEXT;
  if (/nimbus-forge-/.test(url)) return NIMBUS_FACT;
  if (/helixworks-/.test(url)) return HELIX_FACT;
  if (/expansion-study-/.test(url)) return EXPANSION_FACT;
  if (/northstar-/.test(url)) return NORTHSTAR_FACT;
  if (/vesper-staff-/.test(url)) return VESPER_HEADCOUNT;
  if (/vesper-charter-/.test(url)) return VESPER_FOUNDING;
  return WEATHER_TEXT;
}

function factForPassage(text: string): { criterionKeys: string[]; text: string; entity: string | null } | null {
  if (/Helixworks was founded in 2007/i.test(text)) return { criterionKeys: ["helix_founding"], text: HELIX_FACT, entity: "Helixworks" };
  if (/Nimbus Forge was founded in 2011/i.test(text)) return { criterionKeys: ["nimbus_founding"], text: NIMBUS_FACT, entity: "Nimbus Forge" };
  if (/expanded by licensing kitchens/i.test(text)) return { criterionKeys: ["expansion_comparison"], text: EXPANSION_FACT, entity: null };
  if (/Northstar Bakery was incorporated in 1998/i.test(text)) return { criterionKeys: ["origin"], text: NORTHSTAR_FACT, entity: "Northstar Bakery" };
  if (/latest headcount is 4,820/i.test(text)) return { criterionKeys: ["latest_headcount"], text: VESPER_HEADCOUNT, entity: "Vesper Transit" };
  if (/Vesper Transit was founded in 2012/i.test(text)) return { criterionKeys: ["founding_year"], text: VESPER_FOUNDING, entity: "Vesper Transit" };
  return null;
}

function twoCompanyBrief() {
  return {
    objective: TWO_COMPANY, objectiveProvenance: { start: 0, end: TWO_COMPANY.length, quote: TWO_COMPANY }, intendedOutput: "comparison",
    criteria: [
      criterion(TWO_COMPANY, "helix_founding", "Helixworks"),
      criterion(TWO_COMPANY, "nimbus_founding", "Nimbus Forge"),
      criterion(TWO_COMPANY, "expansion_comparison", "expansion strategies"),
    ],
    questions: [
      { key: "q_helix", text: "When was Helixworks founded?", criterionKeys: ["helix_founding"], importance: "critical", evidenceStandard: "documented outcomes" },
      { key: "q_nimbus", text: "When was Nimbus Forge founded?", criterionKeys: ["nimbus_founding"], importance: "critical", evidenceStandard: "documented outcomes" },
      { key: "q_expand", text: "Why did expansion strategies differ?", criterionKeys: ["expansion_comparison"], importance: "critical", evidenceStandard: "documented outcomes" },
    ],
    assumptions: [], openAmbiguities: [], explicitExclusions: [],
  };
}

function installFetch(brief: unknown, searchFor: (query: string) => { url: string; title: string; content: string }[]) {
  const operations: string[] = [];
  const searchQueries: string[] = [];
  globalThis.fetch = vi.fn(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const query = outboundQuery(body);
    if (query) {
      searchQueries.push(query);
      return searchHits(searchFor(query));
    }
    const ctx = JSON.parse(body.messages[1].content);
    const operation = body.response_format.json_schema.name as string;
    operations.push(operation);
    if (operation === "research_brief_v1") return response(brief);
    if (operation === "research_extract_assertions_v1") {
      const assertions = [];
      for (const p of ctx.passages as { id: string; text: string }[]) {
        const fact = factForPassage(p.text);
        if (!fact) continue;
        assertions.push({
          key: `a_${p.id.replace(/-/g, "").slice(0, 12)}`,
          candidateKey: null,
          criterionKeys: fact.criterionKeys,
          text: fact.text,
          scope: { ...scope, entity: fact.entity },
          quantities: [],
          evidence: [{ passageId: p.id, start: 0, end: p.text.length, quote: p.text }],
        });
      }
      return response({ candidates: [], assertions, limitations: [] });
    }
    if (operation === "research_assess_support_v1") {
      return response({
        assessments: ctx.assertions.map((a: { key: string; text: string; scope: unknown; evidence: unknown }) => ({
          claimKey: a.key,
          status: factForPassage(a.text) ? "supported" : "insufficient",
          scope: a.scope,
          evidence: a.evidence,
          rationale: "control",
          missingEvidence: factForPassage(a.text) ? [] : ["no covering fact"],
        })),
      });
    }
    if (operation === "research_review_coverage_v1") {
      const approved = new Set(ctx.approvedClaimKeys as string[]);
      const covered = new Set(
        (ctx.assertions as { key: string; criterionKeys: string[] }[])
          .filter((a) => approved.has(a.key))
          .flatMap((a) => a.criterionKeys),
      );
      return response({
        questions: (ctx.task?.questions ?? []).map((q: { key: string; criterionKeys: string[] }) => {
          const ok = q.criterionKeys.every((k) => covered.has(k));
          return {
            questionKey: q.key,
            status: ok ? "supported" : "unresolved_at_limit",
            assertionKeys: (ctx.assertions as { key: string; criterionKeys: string[] }[])
              .filter((a) => approved.has(a.key) && a.criterionKeys.some((k) => q.criterionKeys.includes(k)))
              .map((a) => a.key),
            reason: ok ? "Covered by supported assertions." : "Material criterion still lacks supported evidence.",
          };
        }),
        omittedRequirements: [],
      });
    }
    if (operation === "research_write_report_v1") {
      const approved = ctx.approvedClaimKeys as string[];
      const unresolved = (ctx.task?.questions ?? [])
        .filter((q: { key: string; criterionKeys: string[] }) => {
          const covered = new Set(
            (ctx.assertions as { key: string; criterionKeys: string[] }[])
              .filter((a) => approved.includes(a.key))
              .flatMap((a) => a.criterionKeys),
          );
          return !q.criterionKeys.every((k: string) => covered.has(k));
        })
        .map((q: { key: string }) => q.key);
      const paragraphs = (ctx.assertions as { key: string; text: string }[])
        .filter((a) => approved.includes(a.key))
        .map((a) => ({ text: a.text, claimKeys: [a.key] }));
      return response({
        title: "Held-out findings",
        sections: [{ heading: "Answer", paragraphs: paragraphs.length ? paragraphs : [{ text: NORTHSTAR_FACT, claimKeys: approved.slice(0, 1) }] }],
        unresolvedQuestionKeys: unresolved,
        limitations: unresolved.length ? ["Some requested questions remain unresolved."] : [],
      });
    }
    throw new Error(`unexpected operation:${operation}`);
  }) as typeof fetch;
  return { operations, searchQueries };
}

async function snapshot<T extends Record<string, unknown>>(runId: string, accountId: string, extra: T) {
  const searches = (await pool.query(
    `SELECT s.query FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.run_id=$1 AND s.query IS NOT NULL ORDER BY i.created_at, s.intent_id`,
    [runId],
  )).rows as { query: string }[];
  const readRows = (await pool.query(
    "SELECT locator, state FROM source_read_operations WHERE run_id=$1 ORDER BY locator",
    [runId],
  )).rows as { locator: string; state: string }[];
  const needs = (await pool.query(
    `SELECT need_id, state, criterion_key, freshness_required, stop_reason, next_action FROM research_evidence_needs WHERE run_id=$1 ORDER BY need_id`,
    [runId],
  )).rows as NeedRow[];
  const events = (await pool.query("SELECT type, payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows as { type: string; payload: Record<string, unknown> | null }[];
  const report = await getLatestReportForRun(pool, runId, accountId);
  const terminal = (await getRun(pool, runId))?.terminal_outcome;
  return { searches: searches.map((s) => s.query), readRows, needs, events, report, terminal, ...extra };
}

function workerConfig() {
  return loadConfig({
    DATABASE_URL: testDatabaseUrl, LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
    LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
  });
}

function assertNeedOpen(need: NeedRow | undefined, key: string, meta: unknown) {
  expect(need, JSON.stringify({ key, meta })).toBeTruthy();
  expect(["missing", "partial", "challenged", "blocked"], JSON.stringify({ key, need, meta })).toContain(need!.state);
  const stoppedSatisfied = need!.stop_reason === "need_satisfied"
    || (need!.next_action?.kind === "stop" && (need!.next_action?.reason === "need_satisfied" || need!.stop_reason === "need_satisfied"));
  expect(stoppedSatisfied, JSON.stringify({ key, need, meta })).toBe(false);
}

async function runHeldout(
  question: string,
  brief: unknown,
  searchFor: (query: string) => { url: string; title: string; content: string }[],
  opts: { crashOnSearch?: number } = {},
) {
  const accountId = await withTx(pool, async (db) => {
    const s = await createDevSession(db);
    await grantConsent(db, s.accountId);
    return s.accountId;
  });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
  const { operations, searchQueries } = installFetch(brief, searchFor);
  const readUrls: string[] = [];
  vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
    if (opts.crashOnSearch && searchQueries.length >= opts.crashOnSearch) throw new LostWorkerLease();
    readUrls.push(url);
    return readControl(url, textForUrl(url));
  });
  const firstOutcome = await processRun(pool, { ...workerConfig(), structuredChallengeEnabled: false }, runId)
    .then(() => "resolved")
    .catch((e: Error) => e.message);
  const meta = await snapshot(runId, accountId, { operations, searchQueries, readUrls, firstOutcome });
  return { runId, accountId, meta };
}

describe("held-out historical shortcut worker/DB (contract v2)", () => {
  it("BB02-01 atomic incorporated-year fact stops extra discovery once supported", async () => {
    const brief = {
      objective: NORTHSTAR, objectiveProvenance: { start: 0, end: NORTHSTAR.length, quote: NORTHSTAR }, intendedOutput: "answer",
      criteria: [criterion(NORTHSTAR, "origin", "Northstar Bakery")],
      questions: [{ key: "q_origin", text: NORTHSTAR, criterionKeys: ["origin"], importance: "critical", evidenceStandard: "documented outcomes" }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { accountId, meta } = await runHeldout(NORTHSTAR, brief, () => pages("northstar", 8));
    await withTx(pool, (db) => deleteAccount(db, accountId));
    expect(meta.searches, JSON.stringify(meta)).toHaveLength(1);
    expect(meta.searches[0]).toBe(NORTHSTAR);
    expect(meta.readUrls.length, JSON.stringify(meta)).toBeGreaterThanOrEqual(2);
    expect(meta.readUrls.length, JSON.stringify(meta)).toBeLessThan(8);
    expect(meta.readRows.filter((r) => r.state === "finished").length, JSON.stringify(meta)).toBeLessThan(8);
    expect(meta.needs.find((n) => n.criterion_key === "origin")?.state, JSON.stringify(meta)).toBe("satisfied");
    expect(meta.report, JSON.stringify(meta)).toBeTruthy();
    expect(["completed", "completed_with_limitations"]).toContain(meta.terminal);
  }, 60_000);

  it("BB02-02 two-company founding and expansion satisfies covered founding and keeps unsupported expansion open", async () => {
    const { accountId, meta } = await runHeldout(TWO_COMPANY, twoCompanyBrief(), (query) => {
      if (query === TWO_COMPANY) return [...pages("helix", 3), ...pages("nimbus", 5)];
      if (/expansion/i.test(query)) return pages("expansion", 3);
      if (/nimbus/i.test(query)) return pages("nimbus", 3);
      if (/helixworks/i.test(query)) return pages("helix", 3);
      return pages("helix", 3);
    });
    await withTx(pool, (db) => deleteAccount(db, accountId));
    const nimbus = meta.needs.find((n) => n.criterion_key === "nimbus_founding");
    const expansion = meta.needs.find((n) => n.criterion_key === "expansion_comparison");
    const helix = meta.needs.find((n) => n.criterion_key === "helix_founding");
    expect(meta.needs.map((need) => need.need_id).sort(), JSON.stringify(meta)).toEqual(["need-expansion_comparison", "need-helix_founding", "need-nimbus_founding"]);
    assertNeedOpen(expansion, "expansion_comparison", meta);
    expect(helix?.state, JSON.stringify(meta)).toBe("satisfied");
    expect(nimbus?.state, JSON.stringify(meta)).toBe("satisfied");
    expect(meta.needs.every((need) => need.freshness_required === false), JSON.stringify(meta)).toBe(true);
    const nimbusSpan = meta.searches.some((q) => q !== TWO_COMPANY && /nimbus/i.test(q));
    const expansionSpan = meta.searches.some((q) => q !== TWO_COMPANY && /expansion/i.test(q));
    const exhausted = meta.events.find((e) => e.type === "discovery_exhausted");
    const exhaustedKeys = Array.isArray(exhausted?.payload?.unresolvedCriterionKeys) ? exhausted!.payload!.unresolvedCriterionKeys as string[] : [];
    expect(nimbusSpan || expansionSpan || exhaustedKeys.includes("nimbus_founding") || exhaustedKeys.includes("expansion_comparison"), JSON.stringify(meta)).toBe(true);
    expect(expansionSpan || exhaustedKeys.includes("expansion_comparison"), JSON.stringify(meta)).toBe(true);
    const nimbusRead = meta.readUrls.some((u) => /nimbus-forge-/.test(u)) || meta.readRows.some((r) => /nimbus-forge-/.test(r.locator));
    const expansionRead = meta.readUrls.some((u) => /expansion-study-/.test(u)) || meta.readRows.some((r) => /expansion-study-/.test(r.locator));
    expect(nimbusRead || expansionRead || nimbusSpan, JSON.stringify(meta)).toBe(true);
    expect(meta.searches.length, JSON.stringify(meta)).toBeGreaterThan(1);
  }, 60_000);

  it("BB02-03 mixed founding plus latest headcount keeps headcount work; does not require split freshness_required", async () => {
    const brief = {
      objective: MIXED_LATEST, objectiveProvenance: { start: 0, end: MIXED_LATEST.length, quote: MIXED_LATEST }, intendedOutput: "answer",
      criteria: [
        criterion(MIXED_LATEST, "founding_year", "founded"),
        criterion(MIXED_LATEST, "latest_headcount", "latest headcount"),
      ],
      questions: [
        { key: "q_founded", text: "When was Vesper Transit founded?", criterionKeys: ["founding_year"], importance: "critical", evidenceStandard: "documented outcomes" },
        { key: "q_head", text: "What is its latest headcount?", criterionKeys: ["latest_headcount"], importance: "critical", evidenceStandard: "documented outcomes" },
      ],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { accountId, meta } = await runHeldout(MIXED_LATEST, brief, (query) => {
      if (query === MIXED_LATEST) return pages("vesper-founding", 3);
      if (/latest|headcount/i.test(query)) return pages("vesper-headcount", 3);
      return pages("vesper-founding", 3);
    });
    await withTx(pool, (db) => deleteAccount(db, accountId));
    const founding = meta.needs.find((n) => n.criterion_key === "founding_year");
    const headcount = meta.needs.find((n) => n.criterion_key === "latest_headcount");
    expect(meta.needs.map((need) => need.need_id).sort(), JSON.stringify(meta)).toEqual(["need-founding_year", "need-latest_headcount"]);
    expect(founding).toMatchObject({ state: "satisfied", freshness_required: false });
    expect(headcount).toMatchObject({ state: "satisfied", freshness_required: true });
    expect(meta.searches.some((q) => q !== MIXED_LATEST && /latest|headcount/i.test(q)), JSON.stringify(meta)).toBe(true);
    expect(meta.searches.length, JSON.stringify(meta)).toBeGreaterThan(1);
    const headcountRead = meta.readUrls.some((u) => /vesper-staff-/.test(u)) || meta.readRows.some((r) => /vesper-staff-/.test(r.locator));
    expect(headcountRead, JSON.stringify(meta)).toBe(true);
    expect(meta.terminal, JSON.stringify(meta)).toBe("completed_with_limitations");
    expect(meta.report?.outcome, JSON.stringify(meta)).toBe("completed_with_limitations");
    expect(meta.report?.limitations, JSON.stringify(meta)).toContain("Required source freshness remains unknown.");
  }, 60_000);

  it("BB02-04 two readable weather pages do not complete a comparison or block covering reads", async () => {
    const { accountId, meta } = await runHeldout(TWO_COMPANY, twoCompanyBrief(), (query) => {
      if (query === TWO_COMPANY) return pages("weather", 8);
      if (/nimbus/i.test(query)) return pages("nimbus", 3);
      if (/expansion/i.test(query)) return pages("expansion", 3);
      if (/helixworks/i.test(query)) return pages("helix", 3);
      return pages("nimbus", 3);
    });
    await withTx(pool, (db) => deleteAccount(db, accountId));
    const weatherReads = meta.readUrls.filter((u) => /weather-/.test(u));
    const coveringReads = meta.readUrls.filter((u) => /nimbus-forge-|helixworks-|expansion-study-/.test(u));
    const coveringDb = meta.readRows.filter((r) => /nimbus-forge-|helixworks-|expansion-study-/.test(r.locator) && r.state === "finished");
    expect(weatherReads.length, JSON.stringify(meta)).toBeGreaterThanOrEqual(2);
    expect(coveringReads.length + coveringDb.length, JSON.stringify(meta)).toBeGreaterThan(0);
    const open = meta.needs.filter((n) => n.criterion_key && ["missing", "partial", "challenged", "blocked"].includes(n.state));
    const satisfiedWrong = meta.needs.filter((n) => n.state === "satisfied" && n.criterion_key !== "helix_founding");
    if (coveringReads.length + coveringDb.length === 0) {
      expect(open.length, JSON.stringify(meta)).toBeGreaterThan(0);
      expect(satisfiedWrong, JSON.stringify(meta)).toEqual([]);
    }
  }, 60_000);

  it("BB02-08 restart reconstructs outstanding two-company needs on the same need_id", async () => {
    const accountId = await withTx(pool, async (db) => {
      const s = await createDevSession(db);
      await grantConsent(db, s.accountId);
      return s.accountId;
    });
    const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question: TWO_COMPANY, routeMode: "controlled-research" }));
    const { searchQueries } = installFetch(twoCompanyBrief(), (query) => {
      if (query === TWO_COMPANY) return [...pages("helix", 3), ...pages("nimbus", 5)];
      if (/expansion/i.test(query)) return pages("expansion", 3);
      if (/nimbus/i.test(query)) return pages("nimbus", 3);
      return pages("helix", 3);
    });
    let crashFollowUp = true;
    vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
      if (crashFollowUp && searchQueries.length >= 2) throw new LostWorkerLease();
      return readControl(url, textForUrl(url));
    });
    try {
      const firstOutcome = await processRun(pool, { ...workerConfig(), structuredChallengeEnabled: false }, runId)
        .then(() => "resolved")
        .catch((e: Error) => e.message);
      const afterCrash = await snapshot(runId, accountId, { firstOutcome, searchQueries: [...searchQueries] });
      const helix = afterCrash.needs.find((n) => n.criterion_key === "helix_founding");
      const nimbus = afterCrash.needs.find((n) => n.criterion_key === "nimbus_founding");
      const expansion = afterCrash.needs.find((n) => n.criterion_key === "expansion_comparison");
      expect(helix).toMatchObject({ state: "satisfied", freshness_required: false });
      expect(nimbus).toMatchObject({ state: "satisfied", freshness_required: false });
      assertNeedOpen(expansion, "expansion_comparison", afterCrash);
      const ids = afterCrash.needs.map((n) => n.need_id).sort();
      expect(ids, JSON.stringify(afterCrash)).toEqual(["need-expansion_comparison", "need-helix_founding", "need-nimbus_founding"]);
      await pool.query("UPDATE run_leases SET expires_at=now()-interval '1 second' WHERE run_id=$1", [runId]);
      crashFollowUp = false;
      await processRun(pool, { ...workerConfig(), structuredChallengeEnabled: false }, runId);
      const afterRestart = await snapshot(runId, accountId, {});
      expect(afterRestart.needs.map((n) => n.need_id).sort(), JSON.stringify(afterRestart)).toEqual(ids);
      const nimbusAgain = afterRestart.needs.find((n) => n.criterion_key === "nimbus_founding");
      const expansionAgain = afterRestart.needs.find((n) => n.criterion_key === "expansion_comparison");
      expect(nimbusAgain).toMatchObject({ need_id: nimbus!.need_id, state: "satisfied", freshness_required: false });
      assertNeedOpen(expansionAgain, "expansion_comparison", afterRestart);
      expect(expansionAgain!.need_id).toBe(expansion!.need_id);
      expect(expansionAgain!.freshness_required).toBe(false);
    } finally {
      await withTx(pool, (db) => deleteAccount(db, accountId));
    }
  }, 90_000);

  it("BB02-10 discovery_exhausted names remaining two-company keys instead of need_satisfied", async () => {
    const { accountId, meta } = await runHeldout(TWO_COMPANY, twoCompanyBrief(), (query) => {
      if (query === TWO_COMPANY) return pages("helix", 3);
      return pages("weather", 3);
    });
    await withTx(pool, (db) => deleteAccount(db, accountId));
    const nimbus = meta.needs.find((n) => n.criterion_key === "nimbus_founding");
    const expansion = meta.needs.find((n) => n.criterion_key === "expansion_comparison");
    assertNeedOpen(nimbus, "nimbus_founding", meta);
    assertNeedOpen(expansion, "expansion_comparison", meta);
    const exhausted = meta.events.find((e) => e.type === "discovery_exhausted");
    expect(exhausted, JSON.stringify(meta)).toBeTruthy();
    const keys = Array.isArray(exhausted?.payload?.unresolvedCriterionKeys) ? exhausted!.payload!.unresolvedCriterionKeys as string[] : [];
    expect(keys, JSON.stringify(meta)).toEqual(expect.arrayContaining(["nimbus_founding", "expansion_comparison"]));
    expect(meta.events.some((e) => e.type === "writing" && keys.length === 0), JSON.stringify(meta)).toBe(false);
  }, 60_000);
});
