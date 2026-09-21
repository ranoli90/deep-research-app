/** Fabricated model/search/reader. Production worker + isolated PG for BB-02 historical shortcuts. */
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { unresolvedCriticalCriterionLimitation } from "@deep/research-core";
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
const NORTHSTAR = "When was Northstar Bakery incorporated?";
const TWO_COMPANY = "Compare when Helixworks and Nimbus Forge were founded and explain why their expansion strategies differed.";
const MIXED_LATEST = "When was Vesper Transit founded and what is its latest headcount?";
const COMPOUND_ONE_CRITERION = "When were Ardent Labs and Brindle Works founded?";
const PAIRED_ONE_CRITERION = "When were Ardent Labs and Brindle Works founded, and how did each expand?";
const MIXED_PRESENT_WORKFORCE = "When was Vesper Transit founded and how many employees work there now?";

const HELIX_FACT = "Helixworks was founded in 2007.";
const NIMBUS_FACT = "Nimbus Forge was founded in 2011.";
const EXPANSION_FACT = "Helixworks expanded by licensing kitchens; Nimbus Forge expanded by opening company-owned shops.";
const VESPER_FOUNDING = "Vesper Transit was founded in 2012-04-01 according to its charter filing.";
const VESPER_HEADCOUNT = "Vesper Transit latest headcount is 4,820 employees as of 2026-08-01.";
const NORTHSTAR_FACT = "Northstar Bakery was incorporated in 1998.";
const ARDENT_FACT = "Unlike Brindle Works, Ardent Labs was founded in 2004.";
const ARDENT_PAIRED_FOUNDING = "Ardent Labs was founded in 2004.";
const BRINDLE_PAIRED_EXPANSION = "Brindle Works expanded through regional offices.";
const WEATHER_TEXT = "Regional forecast: rain continues through Friday. Almanac rainfall notes only.";

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

function pages(kind: "helix" | "nimbus" | "expansion" | "weather" | "northstar" | "ardent" | "ardent-paired" | "brindle-paired" | "vesper-founding" | "vesper-headcount", count: number) {
  return Array.from({ length: count }, (_, i) => {
    if (kind === "weather") {
      return { url: `https://weather-${i}.example/forecast`, title: `Forecast ${i}`, content: WEATHER_TEXT };
    }
    if (kind === "helix") {
      return { url: `https://helixworks-${i}.example/history`, title: `Helixworks history ${i}`, content: HELIX_FACT };
    }
    if (kind === "nimbus") {
      return { url: `https://nimbus-forge-${i}.example/about`, title: `Nimbus Forge about ${i}`, content: NIMBUS_FACT };
    }
    if (kind === "expansion") {
      return { url: `https://expansion-study-${i}.example/compare`, title: `Expansion study ${i}`, content: EXPANSION_FACT };
    }
    if (kind === "northstar") {
      return { url: `https://northstar-${i}.example/charter`, title: `Northstar charter ${i}`, content: `${NORTHSTAR_FACT} Page dated 2015-03-01.` };
    }
    if (kind === "ardent") {
      return { url: `https://ardent-labs-${i}.example/history`, title: `Ardent Labs history ${i}`, content: ARDENT_FACT };
    }
    if (kind === "ardent-paired") {
      return { url: `https://ardent-paired-${i}.example/history`, title: `Ardent Labs founding ${i}`, content: ARDENT_PAIRED_FOUNDING };
    }
    if (kind === "brindle-paired") {
      return { url: `https://brindle-paired-${i}.example/history`, title: `Brindle Works expansion ${i}`, content: BRINDLE_PAIRED_EXPANSION };
    }
    if (kind === "vesper-headcount") {
      return { url: `https://vesper-staff-${i}.example/headcount`, title: `Vesper headcount ${i}`, content: VESPER_HEADCOUNT };
    }
    return { url: `https://vesper-charter-${i}.example/founding`, title: `Vesper founding ${i}`, content: `${VESPER_FOUNDING} Filing dated 2012-04-01.` };
  });
}

function textForUrl(url: string): string {
  if (/weather-/.test(url)) return WEATHER_TEXT;
  if (/nimbus-forge-/.test(url)) return NIMBUS_FACT;
  if (/helixworks-/.test(url)) return HELIX_FACT;
  if (/expansion-study-/.test(url)) return EXPANSION_FACT;
  if (/northstar-/.test(url)) return NORTHSTAR_FACT;
  if (/ardent-labs-/.test(url)) return ARDENT_FACT;
  if (/ardent-paired-/.test(url)) return ARDENT_PAIRED_FOUNDING;
  if (/brindle-paired-/.test(url)) return BRINDLE_PAIRED_EXPANSION;
  if (/vesper-staff-/.test(url)) return VESPER_HEADCOUNT;
  if (/vesper-charter-/.test(url)) return VESPER_FOUNDING;
  return WEATHER_TEXT;
}

function factForPassage(text: string): { criterionKeys: string[]; text: string; entity: string | null } | null {
  if (/Helixworks was founded in 2007/i.test(text)) return { criterionKeys: ["helix_founding"], text: HELIX_FACT, entity: "Helixworks" };
  if (/Nimbus Forge was founded in 2011/i.test(text)) return { criterionKeys: ["nimbus_founding"], text: NIMBUS_FACT, entity: "Nimbus Forge" };
  if (/expanded by licensing kitchens/i.test(text)) return { criterionKeys: ["expansion_comparison"], text: EXPANSION_FACT, entity: null };
  if (/Northstar Bakery was incorporated in 1998/i.test(text)) return { criterionKeys: ["origin"], text: NORTHSTAR_FACT, entity: "Northstar Bakery" };
  if (/Unlike Brindle Works, Ardent Labs was founded/i.test(text)) return { criterionKeys: ["founding_dates"], text: ARDENT_FACT, entity: "Ardent Labs" };
  if (/Ardent Labs was founded in 2004/i.test(text)) return { criterionKeys: ["company_histories"], text: ARDENT_PAIRED_FOUNDING, entity: "Ardent Labs" };
  if (/Brindle Works expanded through regional offices/i.test(text)) return { criterionKeys: ["company_histories"], text: BRINDLE_PAIRED_EXPANSION, entity: "Brindle Works" };
  if (/latest headcount is 4,820/i.test(text)) return { criterionKeys: ["latest_headcount"], text: VESPER_HEADCOUNT, entity: "Vesper Transit" };
  if (/Vesper Transit was founded in 2012/i.test(text)) return { criterionKeys: ["founding_year"], text: VESPER_FOUNDING, entity: "Vesper Transit" };
  return null;
}

async function snapshot<T extends Record<string, unknown>>(runId: string, accountId: string, extra: T) {
  const searches = (await pool.query(
    `SELECT s.query FROM search_operations s JOIN provider_intents i ON i.id=s.intent_id WHERE s.run_id=$1 ORDER BY i.created_at`,
    [runId],
  )).rows as { query: string }[];
  const readRows = (await pool.query(
    "SELECT locator, state FROM source_read_operations WHERE run_id=$1 ORDER BY locator",
    [runId],
  )).rows as { locator: string; state: string }[];
  const needs = (await pool.query(
    `SELECT need_id, state, criterion_key, freshness_required, next_action FROM research_evidence_needs WHERE run_id=$1 ORDER BY need_id`,
    [runId],
  )).rows as { need_id: string; state: string; criterion_key: string | null; freshness_required: boolean; next_action: { kind?: string; queryHint?: string } }[];
  const report = await getLatestReportForRun(pool, runId, accountId);
  const terminal = (await getRun(pool, runId))?.terminal_outcome;
  const events = (await pool.query("SELECT type,payload FROM run_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows as { type: string; payload: unknown }[];
  const policies = (await pool.query(
    `SELECT criterion_key,class,max_age_hours,requires_effective_date,requires_version,policy
       FROM criterion_freshness_policies WHERE run_id=$1 ORDER BY criterion_key`,
    [runId],
  )).rows;
  const coverage = (await pool.query("SELECT result FROM research_coverage WHERE run_id=$1", [runId])).rows
    .map((row) => row.result) as { questions?: { failedChecks?: string[] }[]; unresolvedCriterionKeys?: string[] }[];
  return { searches: searches.map((s) => s.query), readRows, needs, report, terminal, events, policies, coverage, ...extra };
}

function workerConfig() {
  return loadConfig({
    DATABASE_URL: testDatabaseUrl, LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "10000000",
    LIVE_BUDGET_SCOPE: crypto.randomUUID(), STRUCTURED_DISCOVERY_ENABLED: "true", LIVE_RETRIEVAL_ENABLED: "true",
  });
}

async function runHeldout(
  question: string,
  brief: unknown,
  searchFor: (query: string) => { url: string; title: string; content: string }[],
  options: {
    beforeProcess?: (ids: { runId: string; accountId: string }) => Promise<void>;
  } = {},
) {
  const accountId = await withTx(pool, async (db) => {
    const s = await createDevSession(db);
    await grantConsent(db, s.accountId);
    return s.accountId;
  });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
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
  const readUrls: string[] = [];
  vi.spyOn(sourceReader, "readSource").mockImplementation(async (url) => {
    readUrls.push(url);
    return readControl(url, textForUrl(url));
  });
  try {
    await options.beforeProcess?.({ runId, accountId });
    await processRun(pool, { ...workerConfig(), structuredChallengeEnabled: false }, runId);
    const meta = await snapshot(runId, accountId, { operations, searchQueries, readUrls });
    return { runId, accountId, meta };
  } finally {
    await withTx(pool, (db) => deleteAccount(db, accountId));
  }
}

describe("held-out historical shortcut worker/DB", () => {
  it("BB02-01 atomic incorporated-year fact stops extra discovery once supported", async () => {
    const brief = {
      objective: NORTHSTAR, objectiveProvenance: { start: 0, end: NORTHSTAR.length, quote: NORTHSTAR }, intendedOutput: "answer",
      criteria: [criterion(NORTHSTAR, "origin", "Northstar Bakery")],
      questions: [{ key: "q_origin", text: NORTHSTAR, criterionKeys: ["origin"], importance: "critical", evidenceStandard: "documented outcomes" }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { meta } = await runHeldout(NORTHSTAR, brief, () => pages("northstar", 8));
    expect(meta.searchQueries, JSON.stringify(meta)).toHaveLength(1);
    expect(meta.searches, JSON.stringify(meta)).toHaveLength(1);
    expect(meta.searches[0]).toBe(NORTHSTAR);
    expect(meta.readUrls.length, JSON.stringify(meta)).toBeGreaterThanOrEqual(2);
    expect(meta.readUrls.length, JSON.stringify(meta)).toBeLessThan(8);
    expect(meta.readRows.filter((r) => r.state === "finished").length, JSON.stringify(meta)).toBeLessThan(8);
    expect(meta.needs.find((n) => n.criterion_key === "origin")?.state, JSON.stringify(meta)).toBe("satisfied");
    expect(meta.report, JSON.stringify(meta)).toBeTruthy();
    expect(["completed", "completed_with_limitations"]).toContain(meta.terminal);
  }, 60_000);

  it("BB02-02 two-company founding and expansion keeps second-company work in needs, searches, reads, and limitations", async () => {
    const brief = {
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
    const { meta } = await runHeldout(TWO_COMPANY, brief, (query) => {
      if (query === TWO_COMPANY) return [...pages("helix", 3), ...pages("nimbus", 5)];
      if (/expansion/i.test(query)) return pages("expansion", 3);
      if (/nimbus/i.test(query)) return pages("nimbus", 3);
      if (/helixworks/i.test(query)) return pages("helix", 3);
      return pages("helix", 3);
    });
    const nimbusRead = meta.readUrls.some((u) => /nimbus-forge-/.test(u)) || meta.readRows.some((r) => /nimbus-forge-/.test(r.locator));
    const expansionRead = meta.readUrls.some((u) => /expansion-study-/.test(u)) || meta.readRows.some((r) => /expansion-study-/.test(r.locator));
    const targetedSearch = meta.searches.some((q) => q !== TWO_COMPANY && /nimbus|expansion/i.test(q));
    expect(nimbusRead, JSON.stringify(meta)).toBe(true);
    expect(targetedSearch || expansionRead, JSON.stringify(meta)).toBe(true);
    expect(meta.searches.length > 1 || nimbusRead, JSON.stringify(meta)).toBe(true);
    const helix = meta.needs.find((n) => n.criterion_key === "helix_founding");
    const nimbus = meta.needs.find((n) => n.criterion_key === "nimbus_founding");
    const expansion = meta.needs.find((n) => n.criterion_key === "expansion_comparison");
    expect(meta.needs.map((n) => n.need_id).sort(), JSON.stringify(meta)).toEqual(["need-expansion_comparison", "need-helix_founding", "need-nimbus_founding"]);
    expect(helix?.state, JSON.stringify(meta)).toBe("satisfied");
    if (!nimbusRead) expect(nimbus?.state, JSON.stringify(meta)).not.toBe("satisfied");
    if (!expansionRead) {
      expect(expansion?.state, JSON.stringify(meta)).not.toBe("satisfied");
      const limitations = (meta.report?.limitations ?? []) as string[];
      expect(limitations, JSON.stringify(meta)).toContain(unresolvedCriticalCriterionLimitation("expansion_comparison"));
      expect(meta.terminal, JSON.stringify(meta)).not.toBe("completed");
    }
  }, 60_000);

  it("BB02-03 mixed founding plus latest headcount issues current-criterion work and does not treat an old founding page as enough", async () => {
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
    const { meta } = await runHeldout(MIXED_LATEST, brief, (query) => {
      if (query === MIXED_LATEST) return pages("vesper-founding", 3);
      if (/latest|headcount/i.test(query)) return pages("vesper-headcount", 3);
      return pages("vesper-founding", 3);
    });
    expect(meta.searches.some((q) => q !== MIXED_LATEST && /latest|headcount/i.test(q)), JSON.stringify(meta)).toBe(true);
    expect(meta.searches.length, JSON.stringify(meta)).toBeGreaterThan(1);
    const founding = meta.needs.find((n) => n.criterion_key === "founding_year");
    const headcount = meta.needs.find((n) => n.criterion_key === "latest_headcount");
    expect(founding?.freshness_required, JSON.stringify(meta)).toBe(false);
    expect(headcount?.freshness_required, JSON.stringify(meta)).toBe(true);
    const headcountRead = meta.readUrls.some((u) => /vesper-staff-/.test(u)) || meta.readRows.some((r) => /vesper-staff-/.test(r.locator));
    expect(headcountRead, JSON.stringify(meta)).toBe(true);
    if (!headcountRead) {
      expect(headcount?.state, JSON.stringify(meta)).not.toBe("satisfied");
      const limitations = (meta.report?.limitations ?? []) as string[];
      expect(limitations, JSON.stringify(meta)).toContain(unresolvedCriticalCriterionLimitation("latest_headcount"));
    }
  }, 60_000);

  it("RES-02 keeps a one-criterion, two-entity historical obligation open after evidence for only one entity", async () => {
    const brief = {
      objective: COMPOUND_ONE_CRITERION,
      objectiveProvenance: { start: 0, end: COMPOUND_ONE_CRITERION.length, quote: COMPOUND_ONE_CRITERION },
      intendedOutput: "answer",
      criteria: [criterion(COMPOUND_ONE_CRITERION, "founding_dates", COMPOUND_ONE_CRITERION)],
      questions: [{
        key: "q_founding_dates",
        text: COMPOUND_ONE_CRITERION,
        criterionKeys: ["founding_dates"],
        importance: "critical",
        evidenceStandard: "documented outcomes for both entities",
      }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { meta } = await runHeldout(
      COMPOUND_ONE_CRITERION,
      brief,
      () => pages("ardent", 3),
    );
    const need = meta.needs.find((item) => item.criterion_key === "founding_dates");
    const exhausted = meta.events.find((event) => event.type === "discovery_exhausted");
    expect(need?.state, JSON.stringify(meta)).not.toBe("satisfied");
    expect(need?.next_action.kind, JSON.stringify(meta)).not.toBe("stop");
    expect(meta.coverage.some((result) => result.questions?.some((question) =>
      question.failedChecks?.includes("criterion_entity_without_assertion:founding_dates:brindle_works"))), JSON.stringify(meta)).toBe(true);
    expect(meta.coverage.some((result) => result.unresolvedCriterionKeys?.includes("founding_dates")), JSON.stringify(meta)).toBe(true);
    expect((exhausted?.payload as { unresolvedCriterionKeys?: string[] } | undefined)?.unresolvedCriterionKeys, JSON.stringify(meta))
      .toContain("founding_dates");
    expect(meta.terminal, JSON.stringify(meta)).not.toBe("completed");
  }, 60_000);

  it("RES-02 keeps crossed entity-fact pairs open through Evidence Needs and publication", async () => {
    const brief = {
      objective: PAIRED_ONE_CRITERION,
      objectiveProvenance: { start: 0, end: PAIRED_ONE_CRITERION.length, quote: PAIRED_ONE_CRITERION },
      intendedOutput: "answer",
      criteria: [criterion(PAIRED_ONE_CRITERION, "company_histories", PAIRED_ONE_CRITERION)],
      questions: [{
        key: "q_company_histories",
        text: PAIRED_ONE_CRITERION,
        criterionKeys: ["company_histories"],
        importance: "critical",
        evidenceStandard: "founding and expansion for each entity",
      }],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { meta } = await runHeldout(
      PAIRED_ONE_CRITERION,
      brief,
      () => [...pages("ardent-paired", 2), ...pages("brindle-paired", 2)],
    );
    const need = meta.needs.find((item) => item.criterion_key === "company_histories");
    const failedChecks = meta.coverage.flatMap((result) => result.questions ?? []).flatMap((question) => question.failedChecks ?? []);
    expect(failedChecks, JSON.stringify(meta)).toEqual(expect.arrayContaining([
      "criterion_obligation_without_assertion:company_histories:ardent_labs:expansion",
      "criterion_obligation_without_assertion:company_histories:brindle_works:founding",
    ]));
    expect(need?.state, JSON.stringify(meta)).not.toBe("satisfied");
    expect(need?.next_action.kind, JSON.stringify(meta)).not.toBe("stop");
    expect(meta.coverage.some((result) => result.unresolvedCriterionKeys?.includes("company_histories")), JSON.stringify(meta)).toBe(true);
    expect(meta.report?.outcome, JSON.stringify(meta)).toBe("completed_with_limitations");
    expect(meta.report?.limitations, JSON.stringify(meta)).toEqual(expect.arrayContaining([
      "Unresolved critical question q_company_histories (unresolved_at_limit).",
      unresolvedCriticalCriterionLimitation("company_histories"),
    ]));
    expect(meta.terminal, JSON.stringify(meta)).toBe("completed_with_limitations");
  }, 60_000);

  it("RES-03 treats natural present-tense employee count as current while its founding sibling stays historical", async () => {
    const brief = {
      objective: MIXED_PRESENT_WORKFORCE,
      objectiveProvenance: { start: 0, end: MIXED_PRESENT_WORKFORCE.length, quote: MIXED_PRESENT_WORKFORCE },
      intendedOutput: "answer",
      criteria: [
        criterion(MIXED_PRESENT_WORKFORCE, "founding_year", "founded"),
        criterion(MIXED_PRESENT_WORKFORCE, "latest_headcount", "how many employees work there now"),
      ],
      questions: [
        { key: "q_founded", text: "When was Vesper Transit founded?", criterionKeys: ["founding_year"], importance: "critical", evidenceStandard: "documented outcomes" },
        { key: "q_workforce", text: "How many employees work there now?", criterionKeys: ["latest_headcount"], importance: "critical", evidenceStandard: "current first-party figure" },
      ],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const { meta } = await runHeldout(MIXED_PRESENT_WORKFORCE, brief, (query) => {
      if (query === MIXED_PRESENT_WORKFORCE) return pages("vesper-founding", 3);
      if (/employees|workforce|headcount/i.test(query)) return pages("vesper-headcount", 3);
      return pages("vesper-founding", 3);
    });
    const founding = meta.needs.find((item) => item.criterion_key === "founding_year");
    const workforce = meta.needs.find((item) => item.criterion_key === "latest_headcount");
    const policyByKey = new Map(meta.policies.map((item) => [String(item.criterion_key), item]));
    expect(founding?.freshness_required, JSON.stringify(meta)).toBe(false);
    expect(workforce?.freshness_required, JSON.stringify(meta)).toBe(true);
    expect(policyByKey.get("founding_year")?.class, JSON.stringify(meta)).toBe("historical");
    expect(policyByKey.get("latest_headcount")?.class, JSON.stringify(meta)).not.toBe("historical");
    expect(meta.searches.some((query) => query !== MIXED_PRESENT_WORKFORCE && /employees|workforce|headcount/i.test(query)), JSON.stringify(meta)).toBe(true);
  }, 60_000);

  it("RES-05 resumes an old run without overwriting persisted v2 identity or meaning", async () => {
    const brief = {
      objective: MIXED_PRESENT_WORKFORCE,
      objectiveProvenance: { start: 0, end: MIXED_PRESENT_WORKFORCE.length, quote: MIXED_PRESENT_WORKFORCE },
      intendedOutput: "answer",
      criteria: [
        criterion(MIXED_PRESENT_WORKFORCE, "founding_year", "founded"),
        criterion(MIXED_PRESENT_WORKFORCE, "latest_headcount", "how many employees work there now"),
      ],
      questions: [
        { key: "q_founded", text: "When was Vesper Transit founded?", criterionKeys: ["founding_year"], importance: "critical", evidenceStandard: "documented outcomes" },
        { key: "q_workforce", text: "How many employees work there now?", criterionKeys: ["latest_headcount"], importance: "critical", evidenceStandard: "current first-party figure" },
      ],
      assumptions: [], openAmbiguities: [], explicitExclusions: [],
    };
    const v2 = {
      version: "criterion-freshness.v2",
      class: "historical",
      maxAgeHours: null,
      requiresEffectiveDate: false,
      requiresVersion: false,
      rationale: "Historical events may prefer contemporaneous authoritative evidence over later summaries.",
    } as const;
    const { meta } = await runHeldout(
      MIXED_PRESENT_WORKFORCE,
      brief,
      (query) => query === MIXED_PRESENT_WORKFORCE ? pages("vesper-founding", 3) : pages("vesper-headcount", 3),
      { beforeProcess: async ({ runId, accountId }) => {
        await pool.query(
          `INSERT INTO criterion_freshness_policies(id,account_id,run_id,criterion_key,class,max_age_hours,requires_effective_date,requires_version,policy)
           VALUES($1,$2,$3,'default','historical',NULL,false,false,$4::jsonb)`,
          [crypto.randomUUID(), accountId, runId, JSON.stringify(v2)],
        );
      } },
    );
    expect(meta.policies, JSON.stringify(meta)).toHaveLength(1);
    expect(meta.policies[0]).toMatchObject({
      criterion_key: "default",
      class: "historical",
      policy: v2,
    });
    expect(meta.needs.find((item) => item.criterion_key === "latest_headcount")?.freshness_required, JSON.stringify(meta)).toBe(false);
  }, 60_000);

  it("BB02-04 two readable weather pages do not complete a comparison or block reading covering sources", async () => {
    const brief = {
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
    const { meta } = await runHeldout(TWO_COMPANY, brief, (query) => {
      if (query === TWO_COMPANY) return pages("weather", 8);
      if (/nimbus/i.test(query)) return pages("nimbus", 3);
      if (/expansion/i.test(query)) return pages("expansion", 3);
      if (/helixworks/i.test(query)) return pages("helix", 3);
      return pages("nimbus", 3);
    });
    const weatherReads = meta.readUrls.filter((u) => /weather-/.test(u));
    const coveringReads = meta.readUrls.filter((u) => /nimbus-forge-|helixworks-|expansion-study-/.test(u));
    const coveringDb = meta.readRows.filter((r) => /nimbus-forge-|helixworks-|expansion-study-/.test(r.locator) && r.state === "finished");
    expect(weatherReads.length, JSON.stringify(meta)).toBeGreaterThanOrEqual(2);
    expect(coveringReads.length + coveringDb.length, JSON.stringify(meta)).toBeGreaterThan(0);
    if (coveringReads.length + coveringDb.length === 0) {
      expect(meta.needs.every((n) => n.state === "satisfied"), JSON.stringify(meta)).toBe(false);
      expect(meta.terminal, JSON.stringify(meta)).not.toBe("completed");
    }
  }, 60_000);
});
