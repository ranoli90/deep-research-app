import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent } from "../src/modules/access.js";
import { insertBrief, insertConversation, insertRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { publishReport } from "../src/modules/reports.js";
import { CONSENT_POLICY_VERSION, type CanonicalReport } from "@deep/contracts";

let pool: pg.Pool;
beforeAll(async () => {
  pool = createPool(process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");
  await migrate(pool);
});
afterAll(async () => { await pool.end(); });

describe("W01 V6-F01 production publication, persisted PostgreSQL evidence", () => {
  const cases = [
    ["PROBE-01", "Atlas does not support offline editing.", "Atlas supports offline editing.", false],
    ["PROBE-02", "Atlas costs 90 EUR per month.", "Atlas costs 9 EUR per month.", false],
    ["PROBE-03", "Atlas is not offered.", "Atlas offers offline editing.", false],
    ["PROBE-04", "Atlas is supported only in Germany.", "Atlas is supported in France.", false],
    ["PROBE-05", "Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["PROBE-06", "Atlas supports offline editing.", "Atlas costs 0 EUR and is available worldwide.", false],
    ["CONTROL-direct", "Atlas supports offline editing.", "Atlas supports offline editing.", true],
    ["CONTROL-paraphrase", "Atlas supports offline editing.", "Offline editing is supported by Atlas.", true],
    ["wrong-owner", "Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["wrong-version", "Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["forged-text", "Atlas does not support offline editing.", "Atlas supports offline editing.", false],
  ] as const;
  it.each(cases)("%s", async (id, evidence, assertion, accepted) => {
    await withTx(pool, async (db) => {
      const { accountId } = await createDevSession(db);
      const consent = await grantConsent(db, accountId);
      const conversationId = await insertConversation(db, accountId, "W01 citation regression");
      const briefId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      await insertBrief(db, { id: briefId, conversationId, originalQuestion: "Does Atlas support offline editing?",
        language: "en", attachmentIds: [], sourceRestrictions: [], nonGoals: [], constraints: [], assumptions: [],
        budgetPolicyId: "default", consentPolicyVersion: CONSENT_POLICY_VERSION, revision: 1 }, accountId);
      await insertRun(db, { id: runId, accountId, conversationId, briefId, routeMode: "fixture", briefRevision: 1,
        consentEpoch: consent.epoch, idempotencyKey: crypto.randomUUID(), budgetMicro: 100_000 });
      const sourceId = await insertSource(db, { accountId, runId, locator: "https://example.org/atlas", title: "Atlas",
        publisher: "Atlas", originCluster: "atlas" });
      const { passageId, versionId } = await insertVersionAndPassage(db, { sourceId, accountId, runId,
        locator: "https://example.org/atlas", text: evidence, accessLevel: "full-text" });
      const claimId = crypto.randomUUID();
      const basis = { briefRevision: 1, evidenceRevision: 0, consentEpoch: consent.epoch, cancellationEpoch: 0, workerLeaseFence: 0 };
      const report: CanonicalReport = { reportId: crypto.randomUUID(), runId, version: 1, basis, outcome: "completed",
        blocks: [{ id: "answer", kind: "text", text: assertion, claimIds: id === "PROBE-06" ? [] : [claimId], citationIds: [passageId] }],
        claimIds: [claimId], limitations: [], sourceAccessSummary: [], routeMode: "fixture" };
      const result = await publishReport(db, { report, accountId: id === "wrong-owner" ? crypto.randomUUID() : accountId,
        loaded: basis, deleted: false,
        claims: id === "PROBE-05" ? [] : [{ id: claimId, text: assertion, type: "external-fact", supportStatus: "direct", passageIds: [passageId] }],
        passages: [{ id: passageId, sourceId, sourceVersionId: id === "wrong-version" ? crypto.randomUUID() : versionId,
          exactText: id === "forged-text" ? assertion : evidence, locator: "document" }] });
      expect(result.accepted).toBe(accepted);
      const saved = await db.query("SELECT id FROM reports WHERE run_id = $1", [runId]);
      expect(saved.rowCount).toBe(accepted ? 1 : 0);
      // Isolation without deleting data from other tests or prior local runs.
      await db.query("ROLLBACK");
    });
  });
});
