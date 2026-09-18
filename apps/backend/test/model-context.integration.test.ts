import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, grantConsent, deleteAccount } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { insertSource, insertVersionAndPassage } from "../src/modules/evidence.js";
import { validateOwnedModelContext } from "../src/modules/model-operations.js";
import type { ModelContext } from "../src/ports/model.js";

const pool = createPool(process.env.TEST_DATABASE_URL!);
beforeAll(() => migrate(pool));
afterAll(() => pool.end());

it("W02 batches complete evidence authorization without accepting a changed binding or deleted owner", async () => {
  const accountId = await withTx(pool, async db => {
    const session = await createDevSession(db);
    await grantConsent(db, session.accountId);
    return session.accountId;
  });
  try {
    const run = await admitRun(pool, accountId, crypto.randomUUID(), CreateRunRequestSchema.parse({
      question: "What do the supplied observations establish?", routeMode: "controlled-research",
    }));
    const sourceId = await insertSource(pool, { accountId, runId: run.runId, locator: "https://example.org/observations", title: "Observations", publisher: "Synthetic", originCluster: "synthetic" });
    for (let index = 0; index < 25; index++) await insertVersionAndPassage(pool, {
      accountId, runId: run.runId, sourceId, locator: "https://example.org/observations", text: `Observation ${index}.`, accessLevel: "partial-text",
    });
    const passages = (await pool.query<ModelContext["passages"][number]>(`SELECT p.id,p.source_version_id AS "sourceVersionId",p.content_hash AS digest,p.exact_text AS text,v.access_level AS "accessLevel" FROM passages p JOIN source_versions v ON v.id=p.source_version_id WHERE p.run_id=$1 ORDER BY p.id`, [run.runId])).rows;
    const context: ModelContext = { question: "What do the supplied observations establish?", task: null, passages, sources: [{ handle: sourceId, title: "Observations" }], assertions: [], approvedClaimKeys: [], draft: null };
    const args = { runId: run.runId, accountId, briefRevision: 1, evidenceRevision: 0, context };
    const query = vi.spyOn(pool, "query");
    const started = performance.now();
    await validateOwnedModelContext(pool, args);
    const queryCount = query.mock.calls.length;
    const elapsedMs = performance.now() - started;
    query.mockRestore();
    console.info(JSON.stringify({ evidenceClass: "real PostgreSQL, synthetic evidence, no model transport", passages: passages.length, queryCount, elapsedMs }));
    for (const change of [{ id: crypto.randomUUID() }, { sourceVersionId: crypto.randomUUID() }, { accessLevel: "full-text" as const }, { text: "Different observation.", digest: createHash("sha256").update("Different observation.").digest("hex") }]) {
      await expect(validateOwnedModelContext(pool, { ...args, context: { ...context, passages: [{ ...passages[0]!, ...change }, ...passages.slice(1)] } })).rejects.toThrow("model_evidence_owner_or_version_mismatch");
    }
    await expect(validateOwnedModelContext(pool, { ...args, context: { ...context, passages: [{ ...passages[0]!, digest: "0".repeat(64) }] } })).rejects.toThrow("model_evidence_digest_mismatch");
    for (const source of [{ handle: sourceId, title: "Changed title" }, { handle: crypto.randomUUID(), title: "Observations" }]) {
      await expect(validateOwnedModelContext(pool, { ...args, context: { ...context, sources: [source] } })).rejects.toThrow("model_source_owner_mismatch");
    }
    await expect(validateOwnedModelContext(pool, { ...args, accountId: crypto.randomUUID() })).rejects.toThrow("stale_model_context");
    await expect(validateOwnedModelContext(pool, { ...args, evidenceRevision: 1 })).rejects.toThrow("stale_model_context");
    // Repeated entries remain independently checked, including an invalid duplicate.
    await validateOwnedModelContext(pool, { ...args, context: { ...context, passages: [passages[0]!, passages[0]!] } });
    await expect(validateOwnedModelContext(pool, { ...args, context: { ...context, passages: [passages[0]!, { ...passages[0]!, sourceVersionId: crypto.randomUUID() }] } })).rejects.toThrow("model_evidence_owner_or_version_mismatch");
    await deleteAccount(pool, accountId);
    await expect(validateOwnedModelContext(pool, args)).rejects.toThrow();
    expect(queryCount).toBe(4);
  } finally {
    await deleteAccount(pool, accountId);
  }
});
