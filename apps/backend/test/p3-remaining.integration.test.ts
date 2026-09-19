import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { MAX_ATTACHMENT_BYTES } from "@deep/contracts";
import { conciseFromCanonical } from "@deep/research-core";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { InjectedCrash, processRun } from "../src/worker/diagnostic-executor.js";
import { getRun, listEvents } from "../src/modules/runs.js";
import { insertVersionAndPassage, loadEvidence } from "../src/modules/evidence.js";
import { getLatestReportForRun, getReportForAccount, publishReport, recordFanout, completionDispatchPayload, fanoutAllowed } from "../src/modules/reports.js";
import { claimLease } from "../src/modules/runs.js";
import { recordIntent, reconcileIntent } from "../src/modules/billing.js";
import { canIssueLiveCall, liveSpendUsedMicro } from "../src/modules/live-spend.js";
import { providerFailureState } from "../src/adapters/model/outcomes.js";
import { redact } from "../src/platform/log.js";
import { exportReportForAccount } from "../src/modules/report-export.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

process.env.DATABASE_URL = TEST_URL;
process.env.APP_AUTH_MODE = "development";
process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
process.env.NODE_ENV = "test";

let pool: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;
let config: AppConfig;

async function authed() {
  const s = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  const body = s.json() as { token: string; accountId: string };
  await app.inject({
    method: "POST",
    url: "/v1/consent",
    headers: { authorization: `Bearer ${body.token}` },
    payload: { grant: true },
  });
  return body;
}

async function createRun(token: string, question: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/runs",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    payload: { question, routeMode: "fixture", ...extra },
  });
}

beforeAll(async () => {
  pool = createPool(TEST_URL);
  await migrate(pool);
  config = loadConfig({ ...process.env, DATABASE_URL: TEST_URL });
  boss = await createQueue(TEST_URL);
  app = await buildApp({ pool, config, boss });
});
beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
});
afterAll(async () => {
  await pool.query(`DELETE FROM pgboss.job WHERE name = 'research-run' AND state IN ('created', 'retry', 'active')`);
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
});

describe("remaining launch-scope IDs", () => {
  it("M04 fixture comparison publishes a wide table, code listing, unicode-safe text, and many citations", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(report).toBeTruthy();
    const blocks = (report!.blocks ?? []) as { id?: string; kind?: string; text?: string; citationIds?: string[] }[];
    const table = blocks.find((b) => b.kind === "table");
    const code = blocks.find((b) => b.kind === "code");
    expect(table?.id).toBe("comparison-table");
    expect(table?.text).toMatch(/Vendor \| Region \| Price/);
    expect(table?.text).toMatch(/Vendor A/);
    expect((table?.citationIds ?? []).length).toBeGreaterThan(1);
    expect(code?.id).toBe("candidate-listing");
    expect(code?.text).toMatch(/Vendor A/);
    const cited = blocks.flatMap((b) => b.citationIds ?? []);
    expect(new Set(cited).size).toBeGreaterThan(1);
  });

  it("R06 preserves event date vs publication date", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare the 2019 outage with the 2026 policy period");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/2019-03-12|March 2019/);
    expect(text).toMatch(/2026-01-01|2026-2027|2026-04-01/);
  });

  it("R10 declines an unrelated celebrity branch from page content", async () => {
    const { token } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const events = await listEvents(pool, runId, 0);
    expect(JSON.stringify(events)).toMatch(/out-of-coverage|action_rejected|Declined/i);
    expect(events.filter((e) => e.type === "searched").every((e) => !/taylor swift/i.test(e.public_summary))).toBe(true);
  });

  it("R12 explains different percentage denominators instead of averaging", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Why do both sources say 50% for the backup add-on?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/denominator/i);
    expect(text).toMatch(/not averaged/);
    expect(text).not.toMatch(/were averaged|average of the two/i);
  });

  it("R15 states unknown without a fake probability", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What is the melting point of Unobtainium-99?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks) + JSON.stringify(report?.limitations);
    expect(text).toMatch(/no reliable|unknown|not found/i);
    expect(text).not.toMatch(/does not exist/);
    expect(text).not.toMatch(/\b\d{2}% (chance|probability|confidence)\b/i);
  });

  it("R16 comparison names the requested entities and constraints", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/Vendor A/);
    expect(text).toMatch(/germany/i);
    expect(text).toMatch(/50/);
  });

  it("E05 new source version does not rewrite the original report citation", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    const passage = evidence.passages[0]!;
    const report = await getLatestReportForRun(pool, runId, accountId);
    const cited = (report?.blocks as { citationIds: string[] }[])[0]!.citationIds[0];
    await insertVersionAndPassage(pool, {
      sourceId: passage.source_id,
      accountId,
      runId,
      locator: "fixture://acme/press/widget-4",
      text: "UPDATED 2026 rewrite that must not replace the original saved passage.",
      accessLevel: "full-text",
    });
    const versions = await pool.query(`SELECT count(*)::int AS n FROM source_versions WHERE source_id = $1`, [passage.source_id]);
    expect(versions.rows[0]!.n).toBeGreaterThanOrEqual(2);
    const still = await getLatestReportForRun(pool, runId, accountId);
    expect((still?.blocks as { citationIds: string[] }[])[0]!.citationIds[0]).toBe(cited);
    const src = await app.inject({ method: "GET", url: `/v1/sources/${cited}`, headers: { authorization: `Bearer ${token}` } });
    expect(src.json().exactText).not.toMatch(/UPDATED 2026 rewrite/);
  });

  it("V2-13 private canary is stored as evidence, omitted from public queries, and denied to another account", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        filename: "patient-note.txt",
        mime: "text/plain",
        text: "Patient CANARY:SECRET99 lives at 1 Private Road",
      },
    });
    const created = await createRun(
      token,
      "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01 using the attached note",
      { attachmentIds: [att.json().attachmentId] },
    );
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    expect(evidence.passages.some((p) => p.exact_text.includes("CANARY:SECRET99"))).toBe(true);
    const intents = await pool.query<{ request_digest: string }>(
      `SELECT request_digest FROM provider_intents WHERE run_id = $1`,
      [runId],
    );
    expect(intents.rows.some((r) => (r.request_digest ?? "").includes("CANARY:SECRET99"))).toBe(false);
    const events = await listEvents(pool, runId, 0);
    expect(JSON.stringify(events)).not.toContain("CANARY:SECRET99");
    const other = await authed();
    const passageId = evidence.passages.find((p) => p.exact_text.includes("CANARY:SECRET99"))!.id;
    const stolen = await app.inject({
      method: "GET",
      url: `/v1/sources/${passageId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect([403, 404]).toContain(stolen.statusCode);
    expect(stolen.json().exactText ?? "").not.toContain("CANARY:SECRET99");
    void accountId;
  });

  it("JOB-1 eligibility-aware comparison under platform and export constraints", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(
      token,
      "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.",
    );
    expect(created.statusCode).toBe(200);
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/NoteKeep/);
    expect(text).toMatch(/Eligible:.*NoteKeep/i);
    expect(text).toMatch(/NoteDroid/);
    expect(text).toMatch(/ineligible|violates/i);
    expect(text).toMatch(/iPhone/i);
    expect(text).not.toMatch(/no option exists outside/i);
    expect(text).not.toMatch(/notes are a type of/i);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${created.json().runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const fields = (snap.json().brief?.constraints ?? []).map((c: { field: string }) => c.field);
    expect(fields).toEqual(expect.arrayContaining(["platform"]));
  });

  it("JOB-1 adding Linux as a hard requirement excludes NoteKeep and keeps NoteAll", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(
      token,
      "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.",
    );
    const parentId = created.json().runId as string;
    await processRun(pool, config, parentId);
    const parent = await getLatestReportForRun(pool, parentId, accountId);
    expect(JSON.stringify(parent?.blocks)).toMatch(/Eligible:.*NoteKeep/i);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${parentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${parentId}/corrections`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: {
        expectedBriefRevision: snap.json().brief.revision,
        correctionText: "Linux is also required",
      },
    });
    expect(corr.statusCode).toBe(200);
    const childId = corr.json().runId as string;
    expect(childId).not.toBe(parentId);
    await processRun(pool, config, childId);
    const child = await getLatestReportForRun(pool, childId, accountId);
    const blocks = (child!.blocks ?? []) as { id: string; text: string }[];
    const answer = blocks.find((b) => b.id === "answer");
    const eligibility = blocks.find((b) => b.id === "eligibility");
    expect(answer?.text).toMatch(/NoteAll/);
    expect(eligibility?.text).toMatch(/Eligible: NoteAll/);
    expect(eligibility?.text).toMatch(/Ineligible: NoteKeep \(platform=linux\)/);
    expect(eligibility?.text).not.toMatch(/Eligible: NoteKeep/);
    expect(JSON.stringify(blocks)).toMatch(/linux/i);
    const childSnap = await app.inject({
      method: "GET",
      url: `/v1/runs/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(childSnap.json().brief.constraints)).toMatch(/linux/i);
  });

  it("JOB-1 removing Linux as a requirement makes NoteKeep eligible again", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(
      token,
      "Compare note-taking apps with offline editing, Android and iPhone support, Linux required, and full export required.",
    );
    const parentId = created.json().runId as string;
    await processRun(pool, config, parentId);
    const parent = await getLatestReportForRun(pool, parentId, accountId);
    const parentElig = ((parent!.blocks ?? []) as { id: string; text: string }[]).find((b) => b.id === "eligibility");
    expect(parentElig?.text).toMatch(/Eligible: NoteAll/);
    expect(parentElig?.text).toMatch(/Ineligible: NoteKeep \(platform=linux\)/);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${parentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${parentId}/corrections`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: {
        expectedBriefRevision: snap.json().brief.revision,
        correctionText: "Linux is no longer required",
      },
    });
    expect(corr.statusCode).toBe(200);
    const childId = corr.json().runId as string;
    await processRun(pool, config, childId);
    const child = await getLatestReportForRun(pool, childId, accountId);
    const eligibility = ((child!.blocks ?? []) as { id: string; text: string }[]).find((b) => b.id === "eligibility");
    expect(eligibility?.text).toMatch(/Eligible: NoteKeep/);
    expect(eligibility?.text).not.toMatch(/Ineligible: NoteKeep \(platform=linux\)/);
    const childSnap = await app.inject({
      method: "GET",
      url: `/v1/runs/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(childSnap.json().brief.constraints)).not.toMatch(/linux/i);
  });

  it("JOB-2 attached document text is stored as supplied evidence and not used as a public query", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        filename: "proposal.txt",
        mime: "text/plain",
        text: "INTERNAL-PROPOSAL: the vendor claims a dedicated vector engine is included in the German 40 EUR plan.",
      },
    });
    const created = await createRun(
      token,
      "Reconcile the attached proposal.txt with public managed Postgres options in Germany under 50 EUR as of 2026-03-01",
      { attachmentIds: [att.json().attachmentId] },
    );
    await processRun(pool, config, created.json().runId);
    const evidence = await loadEvidence(pool, created.json().runId);
    expect(evidence.passages.some((p) => p.exact_text.includes("INTERNAL-PROPOSAL"))).toBe(true);
    expect(evidence.sources.some((s) => (s.canonical_locator ?? "").startsWith("attachment://"))).toBe(true);
    const events = await listEvents(pool, created.json().runId, 0);
    const searches = events.filter((e) => e.type === "searched").map((e) => e.public_summary);
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.join(" ")).not.toMatch(/INTERNAL-PROPOSAL/);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/vector engine|INTERNAL-PROPOSAL|supplied/i);
  });

  it("E06 actual PDF with no readable evidence is disclosed as unread pages", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments/bytes",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "x-document-mime": "application/pdf", "x-file-name": "scan.pdf" },
      payload: await readFile(new URL("./fixtures/documents/empty-page.pdf", import.meta.url)),
    });
    expect(att.statusCode).toBe(201);
    const created = await createRun(token, "Reconcile the attached scan.pdf with public Postgres pricing in Germany under 50 EUR as of 2026-03-01", {
      attachmentIds: [att.json().attachmentId],
    });
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(JSON.stringify(report?.limitations)).toMatch(/text-only|Unread pages/i);
  });

  it("E08 quoted report text is taken from the stored passage", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const answer = (report?.blocks as { id: string; text: string; citationIds: string[] }[]).find((b) => b.id === "answer")!;
    const passage = evidence.passages.find((p) => p.id === answer.citationIds[0])!;
    expect(passage.exact_text.startsWith(answer.text.slice(0, 40)) || answer.text.includes(passage.exact_text.slice(0, 40))).toBe(true);
  });

  it("E09 export citation anchors resolve to owned passages", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${token}` } });
    const exp = await app.inject({
      method: "GET",
      url: `/v1/reports/${snap.json().reportId}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exp.json().format).toBe("markdown");
    expect(JSON.stringify(exp.json())).not.toMatch(/"pdf"/i);
    const md = exp.json().markdown as string;
    expect(md).toMatch(/Vendor A/);
    expect(md).toMatch(/\| Vendor \|/);
    expect(md).toMatch(/Café|Vendor|EUR/);
    expect(md).toContain("## Sources");
    expect(md).toContain("Non-public document locator"); // Diagnostic fixture:// locators are not public URLs.
    expect(md).toContain("Passage locator:");
    const ids = [...md.matchAll(/passage: ([0-9a-f-]{36})/gi)]
      .map((m) => m[1])
      .filter((id): id is string => typeof id === "string");
    expect(ids.length).toBeGreaterThan(0);
    const passages = await pool.query<{ id: string }>(`SELECT id FROM passages WHERE account_id = $1 AND run_id = $2`, [accountId, runId]);
    const ownedIds = new Set(passages.rows.map((r) => r.id));
    for (const id of ids) {
      expect(ownedIds.has(id), `export citation [${id}] must be an owned passage`).toBe(true);
    }
    const references = [...md.matchAll(/\[\^source-(\d+)\](?!:)/g)].map((m) => m[1]);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(md).toContain(`[^source-${reference}]:`);
    // Same-account source access still requires exact run membership; reused evidence
    // resolves only while the immutable source-version and passage digests match.
    const child = await createRun(token, "Inspect reused evidence in the exported report");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE reports SET run_id=$1 WHERE id=$2`, [child.json().runId, snap.json().reportId]);
      const unbound = await exportReportForAccount(client, snap.json().reportId, accountId);
      expect(unbound).toContain("Source unavailable.");
      expect(unbound).not.toContain("Source version:");
      await client.query(`INSERT INTO run_evidence_membership(run_id,account_id,passage_id,source_version_id,origin_run_id,passage_digest,version_digest)
        SELECT $1,p.account_id,p.id,p.source_version_id,p.run_id,p.content_hash,v.content_hash
        FROM passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$2`, [child.json().runId, runId]);
      const reused = await exportReportForAccount(client, snap.json().reportId, accountId);
      expect(reused).toBe(md);
      await client.query(`UPDATE run_evidence_membership SET version_digest='tampered' WHERE run_id=$1`, [child.json().runId]);
      expect(await exportReportForAccount(client, snap.json().reportId, accountId)).toBe(unbound);
      const outsider = await authed();
      expect(await exportReportForAccount(client, snap.json().reportId, outsider.accountId)).toBeNull();
      await client.query("UPDATE reports SET limitations=$1::jsonb WHERE id=$2", [
        JSON.stringify(["A required target remains contradicted; its conclusion is unresolved"]), snap.json().reportId]);
      const limitedExport = await exportReportForAccount(client, snap.json().reportId, accountId);
      expect(limitedExport).toContain("## Limitations");
      expect(limitedExport).toContain("A required target remains contradicted; its conclusion is unresolved");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("J02 a second processRun after completion does not duplicate the report or settlement", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    await processRun(pool, config, runId);
    const reports = await pool.query(`SELECT count(*)::int AS n FROM reports WHERE run_id = $1`, [runId]);
    const settled = await pool.query(`SELECT count(*)::int AS n FROM reservations WHERE run_id = $1 AND state = 'settled'`, [runId]);
    expect(reports.rows[0]!.n).toBe(1);
    expect(settled.rows[0]!.n).toBe(1);
  });

  it("J04 timeout after issue is outcome-unknown, not assumed free", () => {
    expect(providerFailureState({ name: "TimeoutError" })).toBe("outcome-unknown");
    expect(providerFailureState({ name: "AbortError" })).toBe("outcome-unknown");
    expect(providerFailureState({ name: "Error", message: "nope" })).toBe("failed");
  });

  it("J06 cancel after completion keeps the published report", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    await app.inject({ method: "POST", url: `/v1/runs/${runId}/cancel`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    const run = await getRun(pool, runId);
    expect(["completed", "completed_with_limitations"]).toContain(run?.terminal_outcome);
    expect(run?.terminal_outcome).not.toBe("cancelled");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeTruthy();
  });

  it("J08 event cursor returns only later sequences", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const page = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events?after=2`,
      headers: { authorization: `Bearer ${token}` },
    });
    const seqs = page.json().events.map((e: { sequence: number }) => e.sequence);
    expect(seqs.every((n: number) => n > 2)).toBe(true);
  });

  it("J13 live spend kill switch blocks new paid routes but keeps saved reports", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const live = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { question: "live please", routeMode: "controlled-research" },
    });
    expect(live.statusCode).toBe(403);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(report).toBeTruthy();
  });

  it("S03 oversized attachments are rejected", async () => {
    const { token } = await authed();
    const tooBig = "x".repeat(Math.min(MAX_ATTACHMENT_BYTES, 1_200_000) + 1);
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: "big.txt", mime: "text/plain", text: tooBig },
    });
    expect([400, 413]).toContain(att.statusCode);
  });

  it("S07 cross-account reports are denied", async () => {
    const a = await authed();
    const created = await createRun(a.token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, a.accountId);
    const b = await authed();
    const denied = await app.inject({
      method: "GET",
      url: `/v1/reports/${report!.id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(denied.statusCode).toBe(404);
    void getReportForAccount;
  });

  it("S10 redacts tokens and question fields from logs", () => {
    const out = redact({ authorization: "Bearer secret", question: "private", token: "abc", ok: true }) as Record<string, unknown>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.question).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.ok).toBe(true);
  });

  it("S06 / V2-20 does not silently fall back to an unauthorized live processor", async () => {
    const { token } = await authed();
    const live = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { question: "anything", routeMode: "controlled-research" },
    });
    expect(live.statusCode).toBe(403);
    expect(live.json().message).toMatch(/Live route is not enabled/i);
  });

  it("V2-10 a later unavailable fetch does not retract last-access evidence", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const evidence = await loadEvidence(pool, runId);
    await insertVersionAndPassage(pool, {
      sourceId: evidence.passages[0]!.source_id,
      accountId,
      runId,
      locator: "fixture://acme/press/widget-4",
      text: "fetch blocked: source disappeared",
      accessLevel: "blocked",
    });
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/Widget 4/);
    expect(JSON.stringify(report?.blocks)).not.toMatch(/therefore the announcement never happened/i);
  });

  it("V2-11 concise view uses the same answer citations as the body", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const blocks = report?.blocks as { id: string; kind: string; text: string; claimIds: string[]; citationIds: string[] }[];
    const concise = conciseFromCanonical(blocks as Parameters<typeof conciseFromCanonical>[0]);
    expect(concise[0]?.citationIds).toEqual(blocks.find((b) => b.id === "answer")?.citationIds);
  });

  it("V2-19 scanned tables stay unread rather than guessed", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What does the unreadable scanned table say about compatibility?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/unread|scanned table|extract_table/i);
  });

  it("R17 concise request still keeps limitations", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Give a concise comparison of managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const concise = conciseFromCanonical(report?.blocks as Parameters<typeof conciseFromCanonical>[0]);
    expect(JSON.stringify(report?.limitations)).toMatch(/not an exhaustive|not comprehensive|opaque provider/i);
    expect(concise.some((b) => b.id === "answer")).toBe(true);
    expect(concise.length).toBeLessThan((report?.blocks as unknown[]).length);
  });

  it("R18 compacted checkpoint still lists stored passage ids", async () => {
    const { token } = await authed();
    const created = await createRun(token, "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const ck = await pool.query<{ payload: { compact?: { passageIds?: string[] } } }>(
      `SELECT payload FROM checkpoints WHERE run_id = $1 AND phase = 'writing' ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    const ids = ck.rows[0]?.payload?.compact?.passageIds ?? [];
    expect(ids.length).toBeGreaterThan(0);
    const passages = await pool.query(`SELECT id FROM passages WHERE run_id = $1`, [runId]);
    const have = new Set(passages.rows.map((p: { id: string }) => p.id));
    expect(ids.every((id) => have.has(id))).toBe(true);
  });

  it("R19 diagnostic follow-up keeps the parent report without claiming executed targeted verification", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const parent = await getLatestReportForRun(pool, created.json().runId, accountId);
    const follow = await app.inject({
      method: "POST",
      url: `/v1/runs/${created.json().runId}/follow-up`,
      headers: { authorization: `Bearer ${token}` },
      payload: { claimId: parent?.claim_ids[0], note: "Verify the Widget 4 announcement only" },
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.json()).toMatchObject({reopenedDiscovery:true,verificationMode:"diagnostic_research"});
    await processRun(pool, config, follow.json().runId);
    expect(await getLatestReportForRun(pool, created.json().runId, accountId)).toBeTruthy();
    expect(parent?.id).toBeTruthy();
    const childEvents = await listEvents(pool, follow.json().runId, 0);
    expect(JSON.stringify(childEvents)).toMatch(/diagnostic research rerun/i);
    expect(JSON.stringify(childEvents)).not.toMatch(/will verify the named claim without reopening/i);
    const childReport = await getLatestReportForRun(pool, follow.json().runId, accountId);
    expect(childReport).toBeTruthy();
    expect(childReport?.id).not.toBe(parent?.id);
    const summary = childReport?.change_summary ?? childReport?.changeSummary;
    const notes = typeof summary === "string" ? summary : JSON.stringify(summary);
    expect(notes??"").not.toMatch(/Targeted follow-up verified|without reopening candidate discovery/i);
  });

  it("R20 dates a retrieved price and keeps a founding year as history", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What is Vendor A's current price and founding year?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/as of 2024-01-01|not presented as the current price/i);
    expect(text).toMatch(/2011/);
    expect(text).not.toMatch(/current price is 40 EUR with no date/i);
  });

  it("R21 labels a German original as a translation", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What does the German Hinweis say about Frankfurt availability?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/Original language: de/i);
    expect(JSON.stringify(report?.blocks)).toMatch(/not a verbatim original quote/i);
  });

  it("E03 preserves the adults-over-65 qualifier", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Is this agent safe for everyone according to the adults over 65 study?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/adults over 65/i);
    expect(text).toMatch(/does not support an unqualified claim about everyone/i);
  });

  it("E04 report uses the table's 24% rather than 42%", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What does the 2024 completion table list?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/24%/);
    expect(text).not.toMatch(/42%/);
  });

  it("E10 withdraws the conclusion when the asserted 42% is unsupported by the 24% table", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "Confirm the 42% completion figure from the 2024 table");
    expect(created.statusCode).toBe(200);
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(report).toBeTruthy();
    const answer = (report!.blocks as { id: string; text: string; kind: string }[]).find((b) => b.id === "answer");
    expect(answer?.text).toMatch(/withdrawn|removed an unsupported claim/i);
    expect(answer?.kind).toBe("caveat");
    expect(JSON.stringify(report?.limitations)).toMatch(/critical claim was removed/i);
    expect(JSON.stringify(report?.blocks)).toMatch(/24%/);
    expect(answer?.text).not.toMatch(/Completion is 42%/);
  });

  it("J07 expired lease is reclaimed; a live lease is not stolen", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await expect(processRun(pool, config, runId, { crashAfter: "before-publish", workerId: "live-owner" })).rejects.toBeInstanceOf(InjectedCrash);
    const stolen = await claimLease(pool, runId, "other-worker", 30_000);
    expect(stolen).toBeNull();
    await pool.query(`UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1`, [runId]);
    const reclaimed = await claimLease(pool, runId, "other-worker", 30_000);
    expect(reclaimed).toBeGreaterThan(0);
  });

  it("J10 a tight budget still publishes a written report", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await pool.query(`UPDATE runs SET budget_micro = 16000 WHERE id = $1`, [runId]);
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(report).toBeTruthy();
    const run = await getRun(pool, runId);
    expect(run?.terminal_outcome).not.toBe("failed");
    expect(run?.spent_micro ?? 0).toBeLessThanOrEqual(16_000);
  });

  it("J11 reports that app counters are not provider-internal guarantees", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const report = await getLatestReportForRun(pool, created.json().runId, accountId);
    expect(JSON.stringify(report?.limitations)).toMatch(/opaque provider-internal cost/i);
  });

  it("J12 confirmed usage does not rewrite the historical estimate", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    const intentId = await recordIntent(pool, runId, {
      correlationId: "corr-1",
      route: "fixture:search",
      digest: "q",
      reserved: 5_000,
      state: "issued",
    });
    await reconcileIntent(pool, intentId, 4_200);
    const row = await pool.query<{ reserved_max_micro: string; confirmed_micro: string; state: string }>(
      `SELECT reserved_max_micro, confirmed_micro, state FROM provider_intents WHERE id = $1`,
      [intentId],
    );
    expect(Number(row.rows[0]!.reserved_max_micro)).toBe(5_000);
    expect(Number(row.rows[0]!.confirmed_micro)).toBe(4_200);
    expect(row.rows[0]!.state).toBe("confirmed");
  });

  it("J14 duplicate completion epochs share one outbox row and omit query text", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const epoch = await pool.query<{ completion_epoch: string }>(`SELECT completion_epoch FROM runs WHERE id = $1`, [runId]);
    const completionEpoch = Number(epoch.rows[0]!.completion_epoch);
    await recordFanout(pool, { runId, completionEpoch, bindingEpoch: 1, deviceId: "unbound" });
    await recordFanout(pool, { runId, completionEpoch, bindingEpoch: 2, deviceId: "phone-b" });
    const outbox = await pool.query(`SELECT count(*)::int AS n FROM completion_outbox WHERE run_id = $1`, [runId]);
    expect(outbox.rows[0]!.n).toBe(1);
    const fan = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM notification_fanout WHERE run_id = $1`, [runId]);
    expect(Number(fan.rows[0]!.n)).toBeGreaterThanOrEqual(2);
    const payload = completionDispatchPayload(runId, completionEpoch);
    expect(JSON.stringify(payload)).not.toMatch(/Widget 4/);
    expect(fanoutAllowed(2, 1)).toBe(false);
    expect(fanoutAllowed(1, 1)).toBe(true);
    void accountId;
  });

  it("S08 unsigned purchase payloads cannot grant entitlement", async () => {
    const { token, accountId } = await authed();
    const hook = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks",
      payload: { eventId: "evt-forged", product: "pro" },
    });
    expect(hook.statusCode).toBe(401);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/purchases/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { receipt: "forged-unsigned" },
    });
    expect(verify.statusCode).toBe(403);
    const ents = await pool.query(`SELECT count(*)::int AS n FROM entitlements WHERE account_id = $1`, [accountId]);
    expect(ents.rows[0]!.n).toBe(0);
  });

  it("V2-09 deleted attachment text is not left in reports", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: "secret.txt", mime: "text/plain", text: "PRIVATE-DERIVED-SHOULD-GO" },
    });
    const created = await createRun(
      token,
      "Reconcile the attached secret.txt with public Postgres pricing in Germany under 50 EUR as of 2026-03-01",
      { attachmentIds: [att.json().attachmentId] },
    );
    await processRun(pool, config, created.json().runId);
    await app.inject({ method: "POST", url: "/v1/account/deletion", headers: { authorization: `Bearer ${token}` } });
    const passages = await pool.query<{ exact_text: string }>(`SELECT exact_text FROM passages WHERE run_id = $1`, [created.json().runId]);
    expect(passages.rows.every((p) => p.exact_text === "[deleted]" || !p.exact_text.includes("PRIVATE-DERIVED-SHOULD-GO"))).toBe(true);
    const reports = await pool.query<{ blocks: unknown; redacted_at: Date | null }>(
      `SELECT blocks, redacted_at FROM reports WHERE run_id = $1`,
      [created.json().runId],
    );
    expect(JSON.stringify(reports.rows)).not.toMatch(/PRIVATE-DERIVED-SHOULD-GO/);
    expect(reports.rows.every((r) => r.redacted_at || JSON.stringify(r.blocks) === "[]")).toBe(true);
    void accountId;
  });

  it("V2-09 late worker cannot republish deleted private text even if it claims deleted=false", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: "secret.txt", mime: "text/plain", text: "PRIVATE-LATE-WORKER" },
    });
    const created = await createRun(
      token,
      "Reconcile the attached secret.txt with public Postgres pricing in Germany under 50 EUR as of 2026-03-01",
      { attachmentIds: [att.json().attachmentId] },
    );
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing" });
    const run = await getRun(pool, runId);
    await app.inject({ method: "POST", url: "/v1/account/deletion", headers: { authorization: `Bearer ${token}` } });
    const late = await publishReport(pool, {
      report: {
        reportId: crypto.randomUUID(),
        version: 1,
        runId,
        basis: {
          briefRevision: run!.brief_revision,
          evidenceRevision: run!.evidence_revision,
          consentEpoch: run!.consent_epoch,
          cancellationEpoch: run!.cancellation_epoch,
          workerLeaseFence: run!.worker_lease_fence,
        },
        outcome: "completed",
        blocks: [
          {
            id: "answer",
            kind: "text",
            text: "PRIVATE-LATE-WORKER resurrected",
            claimIds: [],
            citationIds: [],
          },
        ],
        claimIds: [],
        limitations: [],
        sourceAccessSummary: [],
        routeMode: "fixture",
      },
      accountId,
      loaded: {
        briefRevision: run!.brief_revision,
        evidenceRevision: run!.evidence_revision,
        consentEpoch: run!.consent_epoch,
        cancellationEpoch: run!.cancellation_epoch,
        workerLeaseFence: run!.worker_lease_fence,
      },
      claims: [],
      passages: [],
      deleted: false,
    });
    expect(late.accepted).toBe(false);
    expect(late.reason).toMatch(/deleted|cancelled/);
    await processRun(pool, config, runId);
    const leftover = await pool.query(`SELECT blocks FROM reports WHERE account_id = $1`, [accountId]);
    expect(JSON.stringify(leftover.rows)).not.toMatch(/PRIVATE-LATE-WORKER/);
    const passages = await pool.query<{ exact_text: string }>(`SELECT exact_text FROM passages WHERE run_id = $1`, [runId]);
    expect(passages.rows.every((p) => p.exact_text === "[deleted]" || !p.exact_text.includes("PRIVATE-LATE-WORKER"))).toBe(true);
  });

  it("expired session cannot read library or reports", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [accountId]);
    const lib = await app.inject({ method: "GET", url: "/v1/library", headers: { authorization: `Bearer ${token}` } });
    expect(lib.statusCode).toBe(401);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${created.json().runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snap.statusCode).toBe(401);
  });

  it("library lists report_id for a completed run so share can resolve", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    await processRun(pool, config, created.json().runId);
    const lib = await app.inject({ method: "GET", url: "/v1/library", headers: { authorization: `Bearer ${token}` } });
    expect(lib.statusCode).toBe(200);
    const item = lib.json().items.find((it: { id: string }) => it.id === created.json().runId);
    expect(item?.report_id).toBeTruthy();
    const exp = await app.inject({
      method: "GET",
      url: `/v1/reports/${item.report_id}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().markdown).toMatch(/Widget 4|ACME/i);
  });

  it("V2-14 outcome-unknown live spend is not treated as zero against the cap", async () => {
    await pool.query(
      `INSERT INTO provider_intents (id, run_id, correlation_id, route, request_digest, reserved_max_micro, state)
       VALUES ($1,$2,$3,'openrouter:web','digest',$4,'outcome-unknown')`,
      [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), 4_000_000],
    );
    const used = await liveSpendUsedMicro(pool);
    expect(used).toBeGreaterThanOrEqual(4_000_000);
    const blocked = canIssueLiveCall({ capMicro: 5_000_000, usedMicro: used, estimatedMicro: 1_200_000 });
    expect(blocked.ok).toBe(false);
    const ifUnknownWereZero = canIssueLiveCall({ capMicro: 5_000_000, usedMicro: 0, estimatedMicro: 1_200_000 });
    expect(ifUnknownWereZero.ok).toBe(true);
  });

  it("M09 web deletion page is reachable without the app and deletes with a session token", async () => {
    const page = await app.inject({ method: "GET", url: "/account/deletion" });
    expect(page.statusCode).toBe(200);
    expect(String(page.headers["content-type"])).toMatch(/text\/html/);
    expect(page.body).toMatch(/Delete account and derived research/);
    expect(page.body).toMatch(/<form method="post"/);
    expect(page.body).not.toMatch(/dev_/);
    const unauth = await app.inject({
      method: "POST",
      url: "/account/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "token=",
    });
    expect(unauth.statusCode).toBe(401);
    const { token, accountId } = await authed();
    const del = await app.inject({
      method: "POST",
      url: "/account/deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `token=${encodeURIComponent(token)}`,
    });
    expect(del.statusCode).toBe(200);
    expect(del.body).toMatch(/Account deleted/);
    const acc = await pool.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM accounts WHERE id = $1`, [accountId]);
    expect(acc.rows[0]?.deleted_at).toBeTruthy();
  });

  it("R02 continue without geography is rejected and does not invent Germany", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What is the filing deadline for employment tax?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    expect((await getRun(pool, runId))?.lifecycle).toBe("awaiting_input");
    const empty = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const still = await getRun(pool, runId);
    expect(still?.lifecycle).toBe("awaiting_input");
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(snap.json().brief.constraints)).not.toMatch(/germany/i);
  });

  it("clarification continue records geography and resumes", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What is the filing deadline for employment tax?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    expect((await getRun(pool, runId))?.lifecycle).toBe("awaiting_input");
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { geography: "Germany" },
    });
    expect(cont.statusCode).toBe(200);
    await processRun(pool, config, runId);
    const row = await getRun(pool, runId);
    expect(row?.lifecycle).toBe("terminal");
    const snap = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${token}` } });
    expect(JSON.stringify(snap.json().brief.constraints)).toMatch(/germany/i);
    const events = await listEvents(pool, runId, 0);
    expect(events.filter((e) => e.type === "clarify")).toHaveLength(1);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(report).toBeTruthy();
    expect(JSON.stringify(report?.blocks)).toMatch(/germany/i);
  });

  it("R02 continue with France records France and does not invent Germany", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What is the filing deadline for employment tax?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { geography: "France" },
    });
    expect(cont.statusCode).toBe(200);
    await processRun(pool, config, runId);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(snap.json().brief.constraints)).toMatch(/france/i);
    expect(JSON.stringify(snap.json().brief.constraints)).not.toMatch(/germany/i);
    const report = await getLatestReportForRun(pool, runId, accountId);
    expect(JSON.stringify(report?.blocks)).toMatch(/geography=france/i);
  });

  it("R02 after France continue discovery uses France evidence not the Germany default note", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token, "What is the filing deadline for employment tax?");
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const cont = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/continue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { geography: "France" },
    });
    expect(cont.statusCode).toBe(200);
    await processRun(pool, config, runId);
    const report = await getLatestReportForRun(pool, runId, accountId);
    const text = JSON.stringify(report?.blocks);
    expect(text).toMatch(/France|french/i);
    expect(text).not.toMatch(/50 EUR Germany constraint/i);
    expect(text).not.toMatch(/Option A meets a 50 EUR/i);
    const events = await listEvents(pool, runId, 0);
    const searches = events.filter((e) => e.type === "searched");
    expect(searches.some((e) => /france/i.test(e.public_summary))).toBe(true);
  });

  it("POST /v1/runs/:id/assumptions confirms and replaces owned assumptions", async () => {
    const { token } = await authed();
    const created = await createRun(token, "should I move to Texas");
    const runId = created.json().runId as string;
    expect(created.statusCode).toBeLessThan(300);
    expect(runId).toMatch(/^[0-9a-f-]{36}$/i);
    const missing = await app.inject({
      method: "POST",
      url: `/v1/runs/${crypto.randomUUID()}/assumptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: "confirm", values: [] },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.stringify(missing.json())).not.toMatch(/Route POST:/);
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/assumptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: "confirm", values: [] },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toMatchObject({ runId, action: "confirm" });
    const replace = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/assumptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: "replace", values: ["Use official Texas sources only."] },
    });
    expect(replace.statusCode).toBe(200);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(snap.json().brief.assumptions)).toMatch(/official Texas sources/i);
  });
});
