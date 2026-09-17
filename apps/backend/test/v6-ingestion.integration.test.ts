import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent, deleteAccount } from "../src/modules/access.js";
import { insertBrief, insertConversation, insertRun } from "../src/modules/runs.js";
import { insertSource, insertExtractedVersion, type DownloadReceipt } from "../src/modules/evidence.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";

let pool: pg.Pool;
beforeAll(async () => { pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test"); await migrate(pool); });
afterAll(async () => pool.end());

it("W04 persists immutable byte/locator provenance, rejects error-page evidence, and deletes its raw and derived artifacts", async () => {
  await withTx(pool, async (db) => {
    const { accountId } = await createDevSession(db);
    await grantConsent(db, accountId);
    const conversationId = await insertConversation(db, accountId, "ingestion provenance");
    const briefId = crypto.randomUUID(), runId = crypto.randomUUID();
    await insertBrief(db, { id: briefId, conversationId, originalQuestion: "What does the source say?", language: "en", attachmentIds: [],
      sourceRestrictions: [], nonGoals: [], constraints: [], assumptions: [], budgetPolicyId: "default", consentPolicyVersion: CONSENT_POLICY_VERSION, revision: 1 }, accountId);
    await insertRun(db, { id: runId, accountId, conversationId, briefId, routeMode: "fixture", briefRevision: 1, consentEpoch: 1,
      idempotencyKey: crypto.randomUUID(), budgetMicro: 100_000 });
    const sourceId = await insertSource(db, { accountId, runId, locator: "https://example.org/source", title: "source", publisher: "example", originCluster: "example" });
    const bytes = Buffer.from("Scoped content with a unique private canary.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const receipt: DownloadReceipt = { requestedUrl: "https://example.org/source", finalUrl: "https://example.org/source", redirectChain: [],
      status: 200, mime: "text/plain", retrievedAt: new Date().toISOString(), outcome: "successful_body" };
    const extraction = { version: "trafilatura-2.2.0/structure-v1" as const, digest, status: "extracted" as const, warnings: [],
      blocks: [{ kind: "text" as const, locator: "paragraph:0", text: bytes.toString(), rows: [] }] };
    const versionId = await insertExtractedVersion(db, { accountId, runId, sourceId, receipt, bytes, extraction });
    const saved = await db.query("SELECT p.exact_text,p.locator,p.extraction_method,v.access_level FROM passages p JOIN source_versions v ON v.id=p.source_version_id WHERE v.id=$1", [versionId]);
    expect(saved.rows[0].exact_text).toBe(bytes.toString());
    expect(saved.rows[0].locator.block).toBe("paragraph:0");
    expect(saved.rows[0].access_level).toBe("partial-text");
    expect(saved.rows[0].extraction_method).toBe(extraction.version);
    const failed = await insertExtractedVersion(db, { accountId, runId, sourceId, bytes, extraction,
      receipt: { ...receipt, status: 404, outcome: "unavailable_status" } });
    expect((await db.query("SELECT id FROM passages WHERE source_version_id=$1", [failed])).rowCount).toBe(0);
    const wrongOwner = crypto.randomUUID();
    await expect(insertExtractedVersion(db, { accountId: wrongOwner, runId, sourceId, receipt, bytes, extraction })).rejects.toThrow("source_owner_mismatch");
    await expect(insertExtractedVersion(db, { accountId, runId, sourceId, receipt, bytes, extraction: { ...extraction, digest: "0".repeat(64) } })).rejects.toThrow("extraction_digest_mismatch");
    await deleteAccount(db, accountId);
    expect((await db.query("SELECT id FROM evidence_artifacts WHERE account_id=$1", [accountId])).rowCount).toBe(0);
    expect((await db.query("SELECT id FROM extraction_receipts WHERE account_id=$1", [accountId])).rowCount).toBe(0);
    expect((await db.query("SELECT exact_text FROM passages WHERE account_id=$1", [accountId])).rows.every((r) => r.exact_text === "[deleted]")).toBe(true);
    await db.query("ROLLBACK");
  });
});
