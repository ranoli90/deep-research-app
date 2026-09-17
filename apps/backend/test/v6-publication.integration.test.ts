import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent } from "../src/modules/access.js";
import { insertBrief, insertConversation, insertRun } from "../src/modules/runs.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { publishReport } from "../src/modules/reports.js";
import { CONSENT_POLICY_VERSION, type CanonicalReport } from "@deep/contracts";
import { createHash } from "node:crypto";
import type { StoredClaim } from "@deep/research-core";

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
    ["unmapped-extra-sentence", "Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["duplicate-claim-id", "Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["myth", "It is a myth that Atlas supports offline editing.", "Atlas supports offline editing.", false],
    ["conditional", "If Atlas supports offline editing, it could replace the desktop client.", "Atlas supports offline editing.", false],
    ["role-reversal", "Atlas acquired Borealis.", "Borealis acquired Atlas.", false],
    ["uncertain", "Atlas may support offline editing next year.", "Atlas supports offline editing.", false],
    ["derived-source-count", "Atlas supports offline editing.", "Recorded 1 source(s) in 1 origin cluster(s). Repeated syndication is not counted as independent confirmation.", true],
    ["forged-source-count", "Atlas supports offline editing.", "Recorded 100 source(s) in 100 origin cluster(s). Repeated syndication is not counted as independent confirmation.", false],
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
      if (id === "unmapped-extra-sentence") report.blocks[0]!.text += " Atlas costs 0 EUR worldwide.";
      const claims: StoredClaim[] = id === "PROBE-05" ? [] : [{ id: claimId, text: assertion, type: "external-fact", supportStatus: "direct", passageIds: [passageId] }];
      if (id === "duplicate-claim-id") claims.unshift({ ...claims[0]!, text: "Atlas costs 0 EUR worldwide." });
      if (id === "derived-source-count" || id === "forged-source-count") {
        claims[0]!.derivation = "source-counts";
        claims[0]!.type = "calculation";
        claims[0]!.passageIds = [];
        report.blocks[0]!.citationIds = [];
      }
      const result = await publishReport(db, { report, accountId: id === "wrong-owner" ? crypto.randomUUID() : accountId,
        loaded: basis, deleted: false,
        claims,
        passages: [{ id: passageId, sourceId, sourceVersionId: id === "wrong-version" ? crypto.randomUUID() : versionId,
          exactText: id === "forged-text" ? assertion : evidence, locator: "document" }] });
      expect(result.accepted).toBe(accepted);
      const saved = await db.query("SELECT id FROM reports WHERE run_id = $1", [runId]);
      expect(saved.rowCount).toBe(accepted ? 1 : 0);
      const checks = await db.query(`SELECT c.text, c.text_digest, s.evidence_digest, s.checker_version, s.decision,
        r.claim_ids[1] AS published_claim_id, c.claim_id
        FROM claim_revisions c JOIN support_assessments s ON s.claim_revision_id=c.id
        JOIN reports r ON r.run_id=c.run_id WHERE c.run_id=$1`, [runId]);
      expect(checks.rowCount).toBe(accepted && id !== "derived-source-count" ? 1 : 0);
      if (accepted && id !== "derived-source-count") {
        expect(checks.rows[0].text).toBe(assertion);
        expect(checks.rows[0].text_digest).toBe(createHash("sha256").update(assertion).digest("hex"));
        expect(checks.rows[0].evidence_digest).toBe(createHash("sha256").update(evidence).digest("hex"));
        expect(checks.rows[0].checker_version).toBe("literal-scope-v4");
        expect(checks.rows[0].decision).toBe("supports");
        expect(checks.rows[0].published_claim_id).toBe(checks.rows[0].claim_id);
      }
      const derivations = await db.query("SELECT kind,inputs FROM report_derivations WHERE run_id=$1", [runId]);
      expect(derivations.rowCount).toBe(id === "derived-source-count" ? 1 : 0);
      if (id === "derived-source-count") {
        expect(derivations.rows[0].kind).toBe("source-counts");
        expect(derivations.rows[0].inputs).toHaveLength(1);
        expect(derivations.rows[0].inputs[0].id).toBe(sourceId);
      }
      // Isolation without deleting data from other tests or prior local runs.
      await db.query("ROLLBACK");
    });
  });
});
