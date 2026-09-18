import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { claimLease } from "../src/modules/runs.js";
import { fencedSession, type FencedSession } from "../src/worker/fenced-session.js";
import { loadConfig } from "../src/platform/config.js";
import { ensureResearchTask } from "../src/worker/research-task.js";
import { performPublicSearch } from "../src/worker/public-search.js";
import { adoptSearchSources } from "../src/modules/search-sources.js";
import { persistFreshnessPolicy, persistReconciliation, persistSearchCoverage } from "../src/modules/retrieval-intelligence.js";
import { prepareEvidenceSelection } from "../src/modules/evidence-selections.js";
import { reconcileDocumentClaim, recordSearchCoverage } from "@deep/research-core";

const originalFetch = globalThis.fetch;
let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

const question = "Compare coral and kelp restoration.";
const span = { start: 0, end: question.length, quote: question };
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
const brief = {
  objective: question, objectiveProvenance: span, intendedOutput: "comparison",
  criteria: [{ key: "c1", description: "Compare restoration", field: "restoration", operator: "compare", value: null, unit: null,
    importance: "hard", scope, provenance: span, group: "g1", groupOperator: "all", unresolvedAlternatives: [] }],
  questions: [{ key: "q1", text: question, criterionKeys: ["c1"], importance: "critical", evidenceStandard: "documented outcomes" }],
  assumptions: [], openAmbiguities: [], explicitExclusions: [],
};
const response = (output: unknown = brief) => new Response(JSON.stringify({
  id: "provider-test-id", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
}), { status: 200 });
function searchReply(url = "https://example.org/study") {
  return new Response(JSON.stringify({
    id: "nonbillable-search", model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000003" },
    choices: [{ finish_reason: "stop", message: { annotations: [{ type: "url_citation", url_citation: { url, title: "Study", content: "Restoration findings" } }] } }],
  }));
}

async function runCase(test: (x: { runId: string; accountId: string; fence: number; session: FencedSession; config: ReturnType<typeof loadConfig> }) => Promise<void>) {
  const accountId = await withTx(pool, async (db) => { const s = await createDevSession(db); await grantConsent(db, s.accountId); return s.accountId; });
  const { runId } = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({ question, routeMode: "controlled-research" }));
  const owner = crypto.randomUUID(); const fence = (await claimLease(pool, runId, owner, 30_000))!;
  const session = fencedSession(pool, { runId, accountId, owner, fence, briefRevision: 1, leaseMs: 30_000 });
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true",
    OPENROUTER_API_KEY: "nonbillable-test-key", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_SPEND_CAP_MICRO: "1000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
  try { await test({ runId, accountId, fence, session, config }); }
  finally {
    session.stop();
    await deleteAccount(pool, accountId);
  }
}

async function searchArgs(x: { runId: string; accountId: string; fence: number; session: FencedSession; config: ReturnType<typeof loadConfig> }) {
  globalThis.fetch = vi.fn(async () => response(brief)) as typeof fetch;
  const task = await ensureResearchTask(pool, x.config, x.session, { ...x, briefRevision: 1 });
  if (task.kind !== "task") throw new Error("missing task");
  return {
    args: { ...x, briefRevision: 1, taskId: task.task.id, proposal: { rationale: "Investigate public restoration evidence", action: { type: "search", query: "coral kelp restoration", questionKeys: ["q1"], publicQueryBasis: span } } },
    config: { ...x.config, structuredDiscoveryEnabled: true },
  };
}

describe("Session B retrieval/evidence worker path", () => {
  it("never sends a private canary to the search adapter and keeps mixed-document search blocked without approval", async () => runCase(async (x) => {
    const c = await searchArgs(x);
    globalThis.fetch = vi.fn(async () => searchReply()) as typeof fetch;
    const attachmentId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attachments(id,account_id,filename,mime,size_bytes,storage_ptr,sha256,extracted_text,processing_state)
       VALUES($1,$2,'note.txt','text/plain',12,'db:x',repeat('a',64),'private CANARY:SECRET99 customer nightfall','ready')`,
      [attachmentId, x.accountId],
    );
    await pool.query("UPDATE research_briefs SET payload=jsonb_set(payload,'{attachmentIds}',$2::jsonb) WHERE id=(SELECT brief_id FROM runs WHERE id=$1)", [x.runId, JSON.stringify([attachmentId])]);
    await expect(performPublicSearch(pool, c.config, x.session, c.args)).rejects.toThrow("document_search_requires_public_query_approval");
    expect(fetch).not.toHaveBeenCalled();
    const bodies = vi.mocked(fetch).mock.calls.map((call) => String(call[1]?.body ?? ""));
    expect(bodies.join("\n")).not.toContain("CANARY:SECRET99");
  }));

  it("issues an approved public query without leaking a private canary and persists independence/freshness/reconciliation under deletion", async () => runCase(async (x) => {
    const c = await searchArgs(x);
    globalThis.fetch = vi.fn(async () => searchReply()) as typeof fetch;
    await pool.query(
      `INSERT INTO query_authorizations(id,account_id,run_id,brief_revision,query_digest,proposed_query,authorized_query,terms,approved_private_terms,permission_required,kind)
       VALUES($1,$2,$3,1,repeat('b',64),'coral kelp restoration','coral kelp restoration','[]','[]',false,'approved')`,
      [crypto.randomUUID(), x.accountId, x.runId],
    );
    await pool.query("UPDATE research_briefs SET payload=jsonb_set(payload,'{attachmentIds}',$2::jsonb) WHERE id=(SELECT brief_id FROM runs WHERE id=$1)", [x.runId, JSON.stringify([crypto.randomUUID()])]);
    const first = await performPublicSearch(pool, c.config, x.session, c.args);
    expect(first).toMatchObject({ kind: "search", reused: false });
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(JSON.stringify(sent)).not.toContain("CANARY");
    expect(JSON.stringify(sent)).not.toContain("SECRET99");
    expect(sent.messages[1].content).toBe("coral kelp restoration");
    await x.session.write((db) => adoptSearchSources(db, { ...c.args, intentId: (first as { intentId: string }).intentId }));
    await persistFreshnessPolicy(pool, { accountId: x.accountId, runId: x.runId, question: "What is the current price of Zephyr Pro?" });
    await persistSearchCoverage(pool, { accountId: x.accountId, runId: x.runId, coverage: recordSearchCoverage({ queriesAttempted: ["coral kelp restoration"], unresolvedAbsence: ["current first-party price"] }) });
    const recon = reconcileDocumentClaim({
      question: "What is the current list price of Zephyr Pro?",
      claim: { key: "c1", text: "Zephyr Pro list price is 40 EUR per month." },
      documentText: "Zephyr Pro list price is 40 EUR per month.",
      publicEvidence: [{ sourceId: "s1", accessLevel: "partial-text", text: "Zephyr Pro list price is 40 EUR per month." }],
    });
    await persistReconciliation(pool, { accountId: x.accountId, runId: x.runId, result: recon });
    expect((await pool.query("SELECT count(*)::int AS n FROM query_authorizations WHERE run_id=$1", [x.runId])).rows[0].n).toBeGreaterThan(0);
    expect((await pool.query("SELECT class FROM criterion_freshness_policies WHERE run_id=$1", [x.runId])).rows[0].class).toBe("price");
    expect((await pool.query("SELECT outcome FROM document_web_reconciliations WHERE run_id=$1", [x.runId])).rows[0].outcome).toBe("confirmed");
    expect((await pool.query("SELECT coverage->>'notFoundMeansNonexistence' AS v FROM search_coverage WHERE run_id=$1", [x.runId])).rows[0].v).toBe("false");
    await deleteAccount(pool, x.accountId);
    expect((await pool.query("SELECT 1 FROM query_authorizations WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM criterion_freshness_policies WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM document_web_reconciliations WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM source_origin_links WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM search_coverage WHERE account_id=$1", [x.accountId])).rowCount).toBe(0);
  }));

  it("keeps missing selection proof terminal and does not send all evidence", async () => runCase(async (x) => {
    const result = await x.session.write((db) => prepareEvidenceSelection(db, { accountId: x.accountId, runId: x.runId, briefRevision: 1 }));
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") expect(result.reason).toBe("selection_no_readable_evidence");
  }));
});
