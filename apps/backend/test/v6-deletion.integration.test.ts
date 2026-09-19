import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
import { createDevSession, deleteAccount, repairPendingDeletions } from "../src/modules/access.js";
import { storeAttachment } from "../src/modules/attachments.js";
import { drainFileDeletions } from "../src/modules/file-deletion.js";

let pool: pg.Pool, app: FastifyInstance, boss: PgBoss, config: AppConfig, storageDir: string;
beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  storageDir = await mkdtemp(join(tmpdir(), "deep-deletion-"));
  config = loadConfig({ NODE_ENV: "test", APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "true",
    LIVE_ROUTE_ENABLED: "false", DATABASE_URL: databaseUrl, STORAGE_DIR: storageDir, WRITING_CANCEL_WINDOW_MS: "1" });
  pool = createPool(databaseUrl); await migrate(pool);
  boss = await createQueue(databaseUrl); app = await buildApp({ pool, boss, config });
});
afterAll(async () => { await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); await rm(storageDir, { recursive: true, force: true }); });

it("W03 deletion removes raw attachments and private text from every owned research store", async () => {
  const canary = `PRIVATE-DELETION-${crypto.randomUUID()}`;
  const other = await createDevSession(pool);
  const otherAttachment = await storeAttachment(pool, { accountId: other.accountId, filename: "keep.txt", mime: "text/plain",
    bytes: Buffer.from("other account content"), extractedText: "other account content" });
  const session = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: { email: `${canary}@localhost` } })).json();
  const headers = { authorization: `Bearer ${session.token}` };
  await app.inject({ method: "POST", url: "/v1/consent", headers, payload: { grant: true } });
  const attachment = await app.inject({ method: "POST", url: "/v1/attachments", headers,
    payload: { filename: `${canary}.txt`, text: canary } });
  expect(attachment.statusCode).toBe(200);
  expect((await pool.query("SELECT raw_bytes FROM attachments WHERE id=$1", [attachment.json().attachmentId])).rows[0].raw_bytes.toString()).toBe(canary);
  const legacyId = crypto.randomUUID(), ptr = join(storageDir, `${session.accountId}-${legacyId}`);
  await writeFile(ptr, canary);
  await pool.query(`INSERT INTO attachments (id,account_id,filename,mime,size_bytes,storage_ptr,processing_state,extracted_text)
    VALUES ($1,$2,$3,'text/plain',$4,$5,'extracted',$3)`, [legacyId, session.accountId, canary, canary.length, ptr]);
  const accepted = await app.inject({ method: "POST", url: "/v1/runs", headers: { ...headers, "idempotency-key": canary },
    payload: { question: `Compare managed Postgres in Germany under 50 EUR/month as of 2026-03-01. ${canary}`,
      routeMode: "fixture", attachmentIds: [attachment.json().attachmentId] } });
  expect(accepted.statusCode).toBe(200);
  const runId = accepted.json().runId;
  await processRun(pool, config, runId);
  const report = (await pool.query("SELECT id FROM reports WHERE run_id=$1", [runId])).rows[0];
  expect(report).toBeTruthy();
  await app.inject({ method: "POST", url: `/v1/reports/${report.id}/challenges`, headers,
    payload: { category: "other", note: canary, includeExcerpt: true } });
  // Exercise fields that the fixture writer does not necessarily populate with the question.
  await pool.query("UPDATE reports SET change_summary=$2, source_access_summary=$2 WHERE id=$1", [report.id, JSON.stringify({ note: canary })]);
  await pool.query("UPDATE runs SET controller_artifacts=$2 WHERE id=$1", [runId, JSON.stringify({ note: canary })]);
  const deleted = await app.inject({ method: "POST", url: "/v1/account/deletion", headers });
  expect(deleted.statusCode).toBe(200);
  expect(deleted.json().deleted).toBe(true);
  for (const table of ["accounts", "attachments", "conversations", "research_briefs", "runs", "run_events", "sources", "source_versions", "passages", "claims", "reports", "challenges", "conclusion_challenges", "research_evidence_needs", "candidate_ledgers"]) {
    const rows = await pool.query(`SELECT row_to_json(t)::text AS content FROM ${table} t WHERE ${table === "accounts" ? "id" : "account_id"}=$1`, [session.accountId]);
    expect.soft(rows.rows.map((r) => r.content).join("\n"), table).not.toContain(canary);
  }
  for (const table of ["checkpoints", "coverage_items", "evidence_gaps", "candidates", "research_contradictions", "research_calculations", "research_disconfirmations", "provider_intents", "run_actions"]) {
    const rows = await pool.query(`SELECT row_to_json(t)::text AS content FROM ${table} t WHERE run_id=$1`, [runId]);
    expect.soft(rows.rows.map((r) => r.content).join("\n"), table).not.toContain(canary);
  }
  await expect.soft(readFile(ptr)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await pool.query("SELECT id FROM attachments WHERE account_id=$1 AND raw_bytes IS NOT NULL", [session.accountId])).rowCount).toBe(0);
  for (const table of ["evidence_artifacts", "extraction_receipts", "claim_revisions", "support_assessments", "report_derivations"]) {
    expect((await pool.query(`SELECT 1 FROM ${table} WHERE account_id=$1`, [session.accountId])).rowCount, table).toBe(0);
  }
  expect((await pool.query("SELECT raw_bytes FROM attachments WHERE id=$1", [otherAttachment])).rows[0].raw_bytes.toString()).toBe("other account content");
  expect(deleted.json().fileCleanupPending).toBe(false);
  expect((await app.inject({ method: "GET", url: "/v1/library", headers })).statusCode).toBe(401);
});

it("W03 an upload blocked behind deletion rechecks the committed account state", async () => {
  const { accountId } = await createDevSession(pool);
  const deleting = await pool.connect();
  let upload: Promise<string | null> | undefined;
  try {
    await deleting.query("BEGIN");
    await deleteAccount(deleting, accountId);
    upload = storeAttachment(pool, { accountId, filename: "private.txt", mime: "text/plain",
      bytes: Buffer.from("late private bytes"), extractedText: "late private bytes" });
    const pid = (await deleting.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const waiters = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))", [pid]);
      if (waiters.rowCount) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true); // Actual multiple-connection lock contention, not a timing-only race assertion.
    await deleting.query("COMMIT");
    expect(await upload).toBeNull();
    expect((await pool.query("SELECT id FROM attachments WHERE account_id=$1", [accountId])).rowCount).toBe(0);
  } finally { await deleting.query("ROLLBACK"); deleting.release(); await upload; }
});

it("W03 committed uploads are erased by a competing deletion without leaving raw bytes", async () => {
  const { accountId } = await createDevSession(pool);
  const uploaded = await storeAttachment(pool, { accountId, filename: "before.txt", mime: "text/plain",
    bytes: Buffer.from("before private"), extractedText: "before private" });
  expect(uploaded).toBeTruthy();
  await Promise.all([deleteAccount(pool, accountId), ...Array.from({ length: 8 }, () => storeAttachment(pool, {
    accountId, filename: "racing.txt", mime: "text/plain", bytes: Buffer.from("racing private"), extractedText: "racing private",
  }))]);
  const rows = await pool.query("SELECT raw_bytes,extracted_text,deleted_at FROM attachments WHERE account_id=$1", [accountId]);
  expect(rows.rowCount).toBeGreaterThan(0);
  for (const row of rows.rows) { expect(row.raw_bytes).toBeNull(); expect(row.extracted_text).toBeNull(); expect(row.deleted_at).toBeTruthy(); }
});

it.each(["challenges", "corrections", "follow-up", "continue"])("W03 a %s request authenticated before deletion cannot restore private content", async (operation) => {
  const session = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json();
  const headers = { authorization: `Bearer ${session.token}` };
  await app.inject({ method: "POST", url: "/v1/consent", headers, payload: { grant: true } });
  const created = await app.inject({ method: "POST", url: "/v1/runs", headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    payload: { question: "Compare managed Postgres in Germany under 50 EUR/month as of 2026-03-01", routeMode: "fixture" } });
  const runId = created.json().runId;
  let url = `/v1/runs/${runId}/${operation}`;
  const payload = operation === "continue" ? { geography: "Germany" } : operation === "corrections"
    ? { correctionText: "Change budget to 70 EUR", expectedBriefRevision: 1 } : { category: "other", note: "LATE-PRIVATE-CONTENT" };
  if (operation === "challenges") {
    await processRun(pool, config, runId);
    const reportId = (await pool.query("SELECT id FROM reports WHERE run_id=$1", [runId])).rows[0].id;
    url = `/v1/reports/${reportId}/challenges`;
  } else if (operation === "continue") await pool.query("UPDATE runs SET lifecycle='awaiting_input' WHERE id=$1", [runId]);
  const deleting = await pool.connect();
  let response: Promise<{ statusCode: number }> | undefined;
  try {
    await deleting.query("BEGIN");
    await deleteAccount(deleting, session.accountId);
    // Uncommitted deletion is invisible to authentication; only the write-time lock can reject this request.
    const issued = app.inject({ method: "POST", url, headers, payload });
    response = issued;
    const pid = (await deleting.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      if ((await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))", [pid])).rowCount) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await deleting.query("COMMIT");
    expect((await issued).statusCode).toBe(401);
    expect((await pool.query("SELECT id FROM research_briefs WHERE account_id=$1 AND payload <> '{}'::jsonb", [session.accountId])).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM challenges WHERE account_id=$1", [session.accountId])).rowCount).toBe(0);
  } finally { await deleting.query("ROLLBACK"); deleting.release(); if (response) await response; }
});

it("W03 old deletion tombstones replay the complete purge after upgrade", async () => {
  const { accountId } = await createDevSession(pool, "old-private-identity@localhost");
  const id = await storeAttachment(pool, { accountId, filename: "old-private.txt", mime: "text/plain",
    bytes: Buffer.from("old private bytes"), extractedText: "old private bytes" });
  await pool.query("UPDATE accounts SET deleted_at=now(),deletion_epoch=1 WHERE id=$1", [accountId]);
  await repairPendingDeletions(pool);
  expect((await pool.query("SELECT email,deletion_cleanup_version,deletion_epoch FROM accounts WHERE id=$1", [accountId])).rows[0])
    .toEqual({ email: null, deletion_cleanup_version: 1, deletion_epoch: "1" });
  expect((await pool.query("SELECT raw_bytes,extracted_text FROM attachments WHERE id=$1", [id])).rows[0])
    .toEqual({ raw_bytes: null, extracted_text: null });
  expect((await pool.query("SELECT id FROM sessions WHERE account_id=$1", [accountId])).rowCount).toBe(0);
});

it("W03 legacy cleanup retries real storage failure and a lost acknowledgement; unsafe pointers cannot delete another object", async () => {
  const { accountId } = await createDevSession(pool);
  const id = crypto.randomUUID(), path = join(storageDir, `${accountId}-${id}`);
  const outside = join(storageDir, "other-owner-file");
  await writeFile(outside, "other owner's content");
  await mkdir(path); // unlink must fail on a directory; emulate a real storage failure without mocks.
  const unsafeId = crypto.randomUUID();
  for (const [attachmentId, pointer] of [[id, path], [unsafeId, outside]]) {
    await pool.query(`INSERT INTO attachments (id,account_id,filename,mime,size_bytes,storage_ptr,processing_state)
      VALUES ($1,$2,'legacy','text/plain',4,$3,'extracted')`, [attachmentId, accountId, pointer]);
  }
  await withTx(pool, (db) => deleteAccount(db, accountId));
  expect(await drainFileDeletions(pool, storageDir, accountId)).toBe(0);
  const failed = await pool.query("SELECT attachment_id,last_error,state FROM file_deletion_outbox WHERE account_id=$1", [accountId]);
  expect(failed.rows.find((r) => r.attachment_id === id)).toMatchObject({ state: "pending", last_error: "storage_unavailable" });
  expect(failed.rows.find((r) => r.attachment_id === unsafeId)).toMatchObject({ state: "pending", last_error: "unsafe_storage_pointer" });
  expect(await readFile(outside, "utf8")).toBe("other owner's content");
  await rm(path, { recursive: true });
  await writeFile(path, "legacy private");
  await pool.query("UPDATE file_deletion_outbox SET next_attempt_at=now() WHERE attachment_id=$1", [id]);
  expect(await drainFileDeletions(pool, storageDir, accountId)).toBe(1);
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  // Deletion completed but its acknowledgement was lost: recovery sees ENOENT and completes again.
  await pool.query("UPDATE file_deletion_outbox SET state='pending',storage_ptr=$2,next_attempt_at=now() WHERE attachment_id=$1", [id, path]);
  expect(await drainFileDeletions(pool, storageDir, accountId)).toBe(1);
  expect((await pool.query("SELECT storage_ptr,attempts FROM file_deletion_outbox WHERE attachment_id=$1", [id])).rows[0]).toEqual({ storage_ptr: "", attempts: 3 });
});
