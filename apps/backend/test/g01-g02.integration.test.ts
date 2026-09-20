import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createPool, migrate } from "../src/platform/db.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
import { getRun, listEvents } from "../src/modules/runs.js";
import { loadEvidence } from "../src/modules/evidence.js";
import { getLatestReportForRun, publishReport } from "../src/modules/reports.js";
import { claimLease } from "../src/modules/runs.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

process.env.DATABASE_URL = TEST_URL;
process.env.APP_AUTH_MODE = "development";
process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
process.env.NODE_ENV = "test";

const COMPARE_Q = "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01";

let pool: pg.Pool;
let app: FastifyInstance;
let boss: PgBoss;
let config: AppConfig;

async function session(): Promise<{ token: string; accountId: string }> {
  const s = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  return s.json() as { token: string; accountId: string };
}

async function grant(token: string): Promise<void> {
  const c = await app.inject({
    method: "POST",
    url: "/v1/consent",
    headers: { authorization: `Bearer ${token}` },
    payload: { grant: true },
  });
  expect(c.statusCode).toBe(200);
}

async function authed(): Promise<{ token: string; accountId: string }> {
  const body = await session();
  await grant(body.token);
  return body;
}

async function createRun(token: string, question = COMPARE_Q, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/runs",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    payload: { question, routeMode: "fixture", ...extra },
  });
}

async function latePublish(
  runId: string,
  accountId: string,
  loaded: {
    briefRevision: number;
    evidenceRevision: number;
    consentEpoch: number;
    cancellationEpoch: number;
    workerLeaseFence: number;
  },
  extra: { citationIds?: string[]; text?: string; deleted?: boolean } = {},
) {
  const evidence = await loadEvidence(pool, runId);
  return publishReport(pool, {
    report: {
      reportId: crypto.randomUUID(),
      version: 1,
      runId,
      basis: loaded,
      outcome: "completed",
      blocks: [
        {
          id: "answer",
          kind: "text",
          text: extra.text ?? "late",
          claimIds: [],
          citationIds: extra.citationIds ?? [],
        },
      ],
      claimIds: [],
      limitations: [],
      sourceAccessSummary: [],
      routeMode: "fixture",
    },
    accountId,
    loaded,
    claims: [],
    passages: evidence.passages.map((p) => ({
      id: p.id,
      sourceId: p.source_id,
      sourceVersionId: p.source_version_id,
      exactText: p.exact_text,
      locator: "document",
    })),
    deleted: extra.deleted ?? false,
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

describe("G01 safety policy", () => {
  it("G01-cross-user: another account cannot read run, events, report, source, export, or mutate", async () => {
    const owner = await authed();
    const created = await createRun(owner.token, "What did ACME announce about Widget 4?");
    expect(created.statusCode).toBe(200);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId);
    const snap = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(snap.statusCode).toBe(200);
    const reportId = snap.json().reportId as string;
    expect(reportId).toBeTruthy();
    const report = await app.inject({
      method: "GET",
      url: `/v1/reports/${reportId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const citationIds: string[] = report.json().blocks.flatMap((b: { citationIds: string[] }) => b.citationIds ?? []);
    expect(citationIds.length).toBeGreaterThan(0);

    const other = await authed();
    const headers = { authorization: `Bearer ${other.token}` };
    const denied = [
      await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers }),
      await app.inject({ method: "GET", url: `/v1/runs/${runId}/events?after=0`, headers }),
      await app.inject({ method: "GET", url: `/v1/reports/${reportId}`, headers }),
      await app.inject({ method: "GET", url: `/v1/reports/${reportId}/export`, headers }),
      await app.inject({ method: "GET", url: `/v1/sources/${citationIds[0]}`, headers }),
      await app.inject({ method: "POST", url: `/v1/runs/${runId}/cancel`, headers }),
      await app.inject({
        method: "POST",
        url: `/v1/runs/${runId}/corrections`,
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        payload: { expectedBriefRevision: 1, correctionText: "budget is 120 EUR" },
      }),
      await app.inject({
        method: "POST",
        url: `/v1/reports/${reportId}/challenges`,
        headers,
        payload: { claimId: crypto.randomUUID(), category: "claim", note: "steal" },
      }),
    ];
    for (const r of denied) {
      expect([401, 403, 404]).toContain(r.statusCode);
      expect(JSON.stringify(r.json())).not.toMatch(/Widget 4|ACME|exactText/i);
    }
    const lib = await app.inject({ method: "GET", url: "/v1/library", headers });
    expect(lib.statusCode).toBe(200);
    expect(lib.json().items.some((it: { id: string }) => it.id === runId)).toBe(false);
  });

  it("G01-private-to-public: attachment canary is stored as evidence and omitted from search queries", async () => {
    const { token } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: "note.txt", mime: "text/plain", text: "Patient CANARY:SECRET99 lives at 1 Private Road" },
    });
    expect(att.statusCode).toBe(200);
    const created = await createRun(token, `${COMPARE_Q} using the attached note`, {
      attachmentIds: [att.json().attachmentId],
    });
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
    const searches = events.filter((e) => e.type === "searched");
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((e) => !/CANARY:SECRET99|1 Private Road/.test(e.public_summary))).toBe(true);
  });

  it("G01-consent: missing, declined, and revoked consent cannot start or continue processing", async () => {
    const unsigned = await session();
    const noGrant = await createRun(unsigned.token);
    expect(noGrant.statusCode).toBe(403);
    expect(noGrant.json().code).toBe("consent_required");

    const declined = await session();
    const deny = await app.inject({
      method: "POST",
      url: "/v1/consent",
      headers: { authorization: `Bearer ${declined.token}` },
      payload: { grant: false },
    });
    expect(deny.statusCode).toBe(200);
    expect(deny.json().granted).toBe(false);
    const afterDeny = await createRun(declined.token);
    expect(afterDeny.statusCode).toBe(403);

    const { token, accountId } = await authed();
    const created = await createRun(token);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing" });
    expect((await getRun(pool, runId))?.phase).toBe("writing");
    const revoke = await app.inject({
      method: "POST",
      url: "/v1/consent",
      headers: { authorization: `Bearer ${token}` },
      payload: { grant: false },
    });
    expect(revoke.statusCode).toBe(200);
    const paused = await getRun(pool, runId);
    const late = await latePublish(runId, accountId, {
      briefRevision: paused!.brief_revision,
      evidenceRevision: paused!.evidence_revision,
      consentEpoch: paused!.consent_epoch,
      cancellationEpoch: paused!.cancellation_epoch,
      workerLeaseFence: paused!.worker_lease_fence,
    });
    expect(late.accepted).toBe(false);
    expect(late.reason).toBe("consent_revoked");
    await processRun(pool, config, runId);
    const done = await getRun(pool, runId);
    expect(done?.lifecycle).toBe("terminal");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
    const next = await createRun(token);
    expect(next.statusCode).toBe(403);
    const corr = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/corrections`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      payload: { expectedBriefRevision: paused!.brief_revision, correctionText: "budget is 120 EUR" },
    });
    expect(corr.statusCode).toBe(403);
  });

  it("G01-deletion: derived text is purged and a late worker cannot resurrect it", async () => {
    const { token, accountId } = await authed();
    const att = await app.inject({
      method: "POST",
      url: "/v1/attachments",
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: "secret.txt", mime: "text/plain", text: "PRIVATE-RESURRECT-ME" },
    });
    const created = await createRun(token, `${COMPARE_Q} using the attached secret.txt`, {
      attachmentIds: [att.json().attachmentId],
    });
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing" });
    const paused = await getRun(pool, runId);
    const del = await app.inject({
      method: "POST",
      url: "/v1/account/deletion",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    const late = await latePublish(
      runId,
      accountId,
      {
        briefRevision: paused!.brief_revision,
        evidenceRevision: paused!.evidence_revision,
        consentEpoch: paused!.consent_epoch,
        cancellationEpoch: paused!.cancellation_epoch,
        workerLeaseFence: paused!.worker_lease_fence,
      },
      { text: "PRIVATE-RESURRECT-ME resurrected", deleted: false },
    );
    expect(late.accepted).toBe(false);
    expect(late.reason).toMatch(/deleted|cancelled/);
    await processRun(pool, config, runId);
    const passages = await pool.query<{ exact_text: string }>(`SELECT exact_text FROM passages WHERE run_id = $1`, [runId]);
    expect(passages.rows.every((p) => p.exact_text === "[deleted]" || !p.exact_text.includes("PRIVATE-RESURRECT-ME"))).toBe(
      true,
    );
    const reports = await pool.query(`SELECT blocks FROM reports WHERE account_id = $1`, [accountId]);
    expect(JSON.stringify(reports.rows)).not.toMatch(/PRIVATE-RESURRECT-ME/);
    const again = await createRun(token);
    expect([401, 403]).toContain(again.statusCode);
  });
});

describe("G02 engineering requirement", () => {
  it("G02-unknown-citation: invented passage IDs cannot publish", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing" });
    const run = await getRun(pool, runId);
    const fake = "00000000-0000-4000-8000-999999999999";
    const result = await latePublish(
      runId,
      accountId,
      {
        briefRevision: run!.brief_revision,
        evidenceRevision: run!.evidence_revision,
        consentEpoch: run!.consent_epoch,
        cancellationEpoch: run!.cancellation_epoch,
        workerLeaseFence: run!.worker_lease_fence,
      },
      { citationIds: [fake], text: "Invented citation" },
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("unknown_citation");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
  });

  it("G02-lost-run: an accepted create remains recoverable from the server after the client drops state", async () => {
    const { token } = await authed();
    const created = await createRun(token, "What did ACME announce about Widget 4?");
    expect(created.statusCode).toBe(200);
    const runId = created.json().runId as string;
    const persisted = await pool.query<{ id: string; lifecycle: string }>(`SELECT id, lifecycle FROM runs WHERE id = $1`, [
      runId,
    ]);
    expect(persisted.rows[0]?.id).toBe(runId);
    const recovered = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().runId ?? recovered.json().id ?? runId).toBeTruthy();
    const lib = await app.inject({ method: "GET", url: "/v1/library", headers: { authorization: `Bearer ${token}` } });
    expect(lib.json().items.some((it: { id: string }) => it.id === runId)).toBe(true);
    await processRun(pool, config, runId);
    const done = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(done.json().reportId).toBeTruthy();
  });

  it("G02-duplicate-debit: replayed completion and idempotent create settle once", async () => {
    const { token, accountId } = await authed();
    const key = crypto.randomUUID();
    const a = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture" },
    });
    const b = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      payload: { question: "What did ACME announce about Widget 4?", routeMode: "fixture" },
    });
    expect(a.json().runId).toBe(b.json().runId);
    expect(b.json().reused).toBe(true);
    const runId = a.json().runId as string;
    await processRun(pool, config, runId);
    const afterFirst = await pool.query<{ n: string; settled: string }>(
      `SELECT a.settled_micro::text AS settled, r.n::text AS n
       FROM allowance_accounts a
       CROSS JOIN (SELECT count(*)::int AS n FROM reservations WHERE run_id = $2) r
       WHERE a.account_id = $1`,
      [accountId, runId],
    );
    await processRun(pool, config, runId);
    const afterSecond = await pool.query<{ n: string; settled: string; reserved_n: string }>(
      `SELECT a.settled_micro::text AS settled,
              (SELECT count(*)::int FROM reservations WHERE run_id = $2) AS n,
              (SELECT count(*)::int FROM reservations WHERE run_id = $2 AND state = 'settled') AS reserved_n
       FROM allowance_accounts a WHERE a.account_id = $1`,
      [accountId, runId],
    );
    expect(Number(afterSecond.rows[0]!.n)).toBe(1);
    expect(Number(afterSecond.rows[0]!.reserved_n)).toBe(1);
    expect(afterSecond.rows[0]!.settled).toBe(afterFirst.rows[0]!.settled);
    const reports = await pool.query(`SELECT count(*)::int AS n FROM reports WHERE run_id = $1`, [runId]);
    expect(reports.rows[0]!.n).toBe(1);
  });

  it("G02-stale-revision: obsolete brief, evidence, or lease cannot publish", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing", workerId: "old-worker" });
    const old = await getRun(pool, runId);
    const loaded = {
      briefRevision: old!.brief_revision,
      evidenceRevision: old!.evidence_revision,
      consentEpoch: old!.consent_epoch,
      cancellationEpoch: old!.cancellation_epoch,
      workerLeaseFence: old!.worker_lease_fence,
    };
    await pool.query(`UPDATE runs SET brief_revision = brief_revision + 1 WHERE id = $1`, [runId]);
    const staleBrief = await latePublish(runId, accountId, loaded);
    expect(staleBrief.accepted).toBe(false);
    expect(staleBrief.reason).toBe("stale_brief");
    await pool.query(`UPDATE runs SET brief_revision = $2, evidence_revision = evidence_revision + 1 WHERE id = $1`, [
      runId,
      loaded.briefRevision,
    ]);
    const staleEvidence = await latePublish(runId, accountId, loaded);
    expect(staleEvidence.accepted).toBe(false);
    expect(staleEvidence.reason).toBe("stale_evidence");
    await pool.query(`UPDATE runs SET evidence_revision = $2 WHERE id = $1`, [runId, loaded.evidenceRevision]);
    await pool.query(`UPDATE run_leases SET expires_at = now() - interval '1 second' WHERE run_id = $1`, [runId]);
    const newer = await claimLease(pool, runId, "new-worker", 30_000);
    expect(newer).toBeGreaterThan(old!.worker_lease_fence);
    const staleLease = await latePublish(runId, accountId, loaded);
    expect(staleLease.accepted).toBe(false);
    expect(staleLease.reason).toBe("stale_lease");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
  });

  it("G02-cancel-writing: cancel during writing rejects late publication", async () => {
    const { token, accountId } = await authed();
    const created = await createRun(token);
    const runId = created.json().runId as string;
    await processRun(pool, config, runId, { pauseAt: "writing" });
    expect((await getRun(pool, runId))?.phase).toBe("writing");
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cancel.statusCode).toBe(200);
    const paused = await getRun(pool, runId);
    const late = await latePublish(runId, accountId, {
      briefRevision: paused!.brief_revision,
      evidenceRevision: paused!.evidence_revision,
      consentEpoch: paused!.consent_epoch,
      cancellationEpoch: Math.max(0, paused!.cancellation_epoch - 1),
      workerLeaseFence: paused!.worker_lease_fence,
    });
    expect(late.accepted).toBe(false);
    expect(late.reason).toMatch(/cancelled/);
    await processRun(pool, config, runId);
    const done = await getRun(pool, runId);
    expect(done?.terminal_outcome).toBe("cancelled");
    expect(await getLatestReportForRun(pool, runId, accountId)).toBeNull();
    const httpReport = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(httpReport.json().reportId ?? null).toBeFalsy();
  });
});
