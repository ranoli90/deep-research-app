import {
  DEFAULT_RUN_BUDGET_MICRO,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import {
  composeReport,
  type ControllerState,
  type StoredClaim,
  type StoredPassage,
} from "@deep/research-core";
import { fixtureProposeAction } from "../adapters/model/fixture.js";
import { openRouterProposeAction } from "../adapters/model/openrouter.js";
import { fixtureFetch, fixtureSearch } from "../adapters/retrieval/fixture.js";
import { safeFetch } from "../platform/ssrf.js";
import type { AppConfig } from "../platform/config.js";
import { withTx, type Queryable } from "../platform/db.js";
import { logInfo } from "../platform/log.js";
import { recordIntent, settleRun } from "../modules/billing.js";
import { insertSource, insertVersionAndPassage, loadEvidence } from "../modules/evidence.js";
import { publishReport } from "../modules/reports.js";
import {
  addSpent,
  bumpEvidence,
  checkpoint,
  claimLease,
  emitEvent,
  getBrief,
  getRun,
  markTerminal,
  setPhase,
} from "../modules/runs.js";
import pg from "pg";

export class InjectedCrash extends Error {
  constructor(public readonly at: string) {
    super(`injected crash at ${at}`);
    this.name = "InjectedCrash";
  }
}

export type ProcessOptions = {
  crashAfter?: "persist-evidence" | "before-publish";
  pauseAt?: "writing" | "researching";
  workerId?: string;
};

function toState(
  run: NonNullable<Awaited<ReturnType<typeof getRun>>>,
  brief: ControllerState["brief"],
  evidence: Awaited<ReturnType<typeof loadEvidence>>,
  deleted: boolean,
  privateCanaries: string[],
): ControllerState {
  const sources = evidence.sources.map((s) => ({
    id: s.id,
    title: s.title,
    locator: s.canonical_locator,
    accessLevel: s.access_level,
    originCluster: s.origin_cluster ?? undefined,
    sourceFamily: s.origin_cluster ?? undefined,
    population: s.population ?? undefined,
  }));
  const passages: StoredPassage[] = evidence.passages.map((p) => ({
    id: p.id,
    sourceId: p.source_id,
    sourceVersionId: p.source_version_id,
    exactText: p.exact_text,
    locator: "document",
  }));
  const families = [...new Set(sources.map((s) => s.originCluster ?? s.id))];
  return {
    runId: run.id,
    brief,
    basis: {
      briefRevision: run.brief_revision,
      evidenceRevision: run.evidence_revision,
      consentEpoch: run.consent_epoch,
      cancellationEpoch: run.cancellation_epoch,
      workerLeaseFence: run.worker_lease_fence,
    },
    phase: run.phase,
    sources,
    passages,
    claims: [],
    coverage: [
      {
        id: "primary",
        question: brief.originalQuestion,
        status: passages.length ? "supported" : sources.length ? "investigating" : "unstarted",
      },
    ],
    gaps:
      brief.constraints.some((c) => c.field === "population") &&
      !sources.some((s) => (s.population ?? "").includes("pediatric") || (s.population ?? "").includes("child"))
        ? [
            {
              id: "population",
              missingFact: "population-specific evidence",
              whyItCouldChangeAnswer: "Adult figures may not apply",
              importance: "blocking",
              sourceTypeNeeded: "population-specific",
              suggestedQuery: `${brief.originalQuestion} pediatric children population`,
            },
          ]
        : [],
    searches: sources.length
      ? [{ query: brief.originalQuestion, sourceFamilyIds: families, newFamilies: families.length, coverageProgress: passages.length > 0 }]
      : [],
    constraints: brief.constraints,
    candidates: [],
    spentMicro: run.spent_micro,
    budgetMicro: run.budget_micro || DEFAULT_RUN_BUDGET_MICRO,
    deleted,
    privateCanaries,
  };
}

async function isDeleted(db: Queryable, accountId: string): Promise<boolean> {
  const res = await db.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM accounts WHERE id = $1`, [accountId]);
  return Boolean(res.rows[0]?.deleted_at);
}

async function privateCanaries(db: Queryable, accountId: string): Promise<string[]> {
  const res = await db.query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM attachments WHERE account_id = $1 AND deleted_at IS NULL AND extracted_text IS NOT NULL`,
    [accountId],
  );
  const out: string[] = [];
  for (const row of res.rows) {
    const t = row.extracted_text ?? "";
    const m = t.match(/CANARY:[A-Z0-9_-]+/g);
    if (m) out.push(...m);
  }
  return out;
}

export async function processRun(pool: pg.Pool, config: AppConfig, runId: string, opts: ProcessOptions = {}): Promise<void> {
  const workerId = opts.workerId ?? config.workerId;
  const fence = await withTx(pool, async (c) => claimLease(c, runId, workerId, config.leaseMs));
  if (fence == null) return;

  for (let step = 0; step < 12; step++) {
    const run = await getRun(pool, runId);
    if (!run) return;
    const deleted = await isDeleted(pool, run.account_id);
    if (run.lifecycle === "terminal") return;

    if (run.lifecycle === "cancelling" || run.cancellation_epoch > 0) {
      await withTx(pool, async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "cancelled",
          summary: "Run cancelled. No new work will be issued. Partial evidence is retained unless deleted.",
          phase: run.phase,
        });
      });
      return;
    }

    if (deleted) {
      await withTx(pool, async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, run.account_id, runId, run.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "deleted",
          summary: "Account or content deleted; late work discarded.",
          phase: run.phase,
        });
      });
      return;
    }

    const brief = await getBrief(pool, run.brief_id);
    const evidence = await loadEvidence(pool, runId);
    const canaries = await privateCanaries(pool, run.account_id);
    const state = toState(run, brief, evidence, deleted, canaries);
    // Keep lease fence from claim, not a stale load.
    state.basis.workerLeaseFence = fence;

    if (run.phase === "writing" && opts.pauseAt === "writing") {
      return;
    }

    let decision = fixtureProposeAction(state);
    if (run.route_mode === "controlled-research" && config.liveRouteEnabled) {
      const live = await openRouterProposeAction(state, config);
      await recordIntent(pool, runId, {
        correlationId: live.receipt.correlationId,
        route: live.receipt.route,
        digest: live.receipt.requestDigest,
        reserved: 20_000,
        state: live.receipt.state,
      });
      decision = live.decision;
    }

    logInfo("action", { runId, type: decision.type, rationale: decision.rationale, step });

    if (decision.type === "clarify") {
      await withTx(pool, async (c) => {
        await setPhase(c, runId, "preparing");
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "clarify",
          summary: `Need a decision-changing detail: ${JSON.stringify(decision.arguments.questions)}`,
          phase: "preparing",
          payload: decision.arguments,
        });
        await c.query(`UPDATE runs SET lifecycle = 'awaiting_input' WHERE id = $1`, [runId]);
      });
      return;
    }

    if (decision.type === "search") {
      const query = String(decision.arguments.query ?? brief.originalQuestion);
      const hits = fixtureSearch(query);
      const evidenceRev = await withTx(pool, async (c) => {
        const existing = await c.query<{ canonical_locator: string }>(
          `SELECT canonical_locator FROM sources WHERE run_id = $1`,
          [runId],
        );
        const have = new Set(existing.rows.map((r) => r.canonical_locator));
        for (const hit of hits) {
          if (have.has(hit.locator)) continue;
          await insertSource(c, {
            accountId: run.account_id,
            runId,
            locator: hit.locator,
            title: hit.title,
            publisher: hit.publisher,
            originCluster: hit.originCluster,
            population: hit.population,
          });
        }
        const rev = await bumpEvidence(c, runId);
        await addSpent(c, runId, FIXTURE_SEARCH_COST_MICRO);
        await recordIntent(c, runId, {
          correlationId: decision.actionId,
          route: "fixture:search",
          digest: query,
          reserved: FIXTURE_SEARCH_COST_MICRO,
          state: "confirmed",
        });
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "searched",
          summary: `Searched: ${query.slice(0, 160)}`,
          phase: "researching",
          payload: { locators: hits.map((h) => h.locator), pivot: Boolean(decision.arguments.pivot) },
        });
        await setPhase(c, runId, "researching");
        return rev;
      });
      if (opts.crashAfter === "persist-evidence") throw new InjectedCrash("persist-evidence");
      await checkpoint(pool, runId, evidenceRev, "researching", { action: "search", query });
      continue;
    }

    if (decision.type === "fetch") {
      const locator = String(decision.arguments.locator ?? "");
      let doc = fixtureFetch(locator);
      if (run.route_mode === "controlled-research" && config.liveRetrievalEnabled && locator.startsWith("http")) {
        try {
          const fetched = await safeFetch(locator);
          doc = {
            locator: fetched.url,
            title: locator,
            publisher: new URL(fetched.url).host,
            originCluster: fetched.url,
            family: fetched.url,
            text: fetched.body.slice(0, 20_000),
            accessLevel: "full-text",
          };
        } catch (err) {
          doc = { ...doc, accessLevel: "blocked", text: `fetch blocked: ${(err as Error).message}` };
        }
      }
      await withTx(pool, async (c) => {
        let sourceId = String(decision.arguments.sourceId ?? "");
        if (!sourceId) {
          const found = await c.query<{ id: string }>(`SELECT id FROM sources WHERE run_id = $1 AND canonical_locator = $2`, [
            runId,
            locator,
          ]);
          sourceId = found.rows[0]?.id ?? (await insertSource(c, {
            accountId: run.account_id,
            runId,
            locator,
            title: doc.title,
            publisher: doc.publisher,
            originCluster: doc.originCluster,
            population: doc.population,
          }));
        }
        const already = await c.query(`SELECT 1 FROM source_versions WHERE source_id = $1 LIMIT 1`, [sourceId]);
        if (!already.rows[0]) {
          await insertVersionAndPassage(c, {
            sourceId,
            accountId: run.account_id,
            runId,
            locator: doc.locator,
            text: doc.text,
            accessLevel: doc.accessLevel,
          });
        }
        const rev = await bumpEvidence(c, runId);
        await addSpent(c, runId, FIXTURE_FETCH_COST_MICRO);
        await recordIntent(c, runId, {
          correlationId: decision.actionId,
          route: "fixture:fetch",
          digest: locator,
          reserved: FIXTURE_FETCH_COST_MICRO,
          state: "confirmed",
        });
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "opened_source",
          summary: `Opened ${doc.title}`,
          phase: "researching",
        });
        return rev;
      });
      if (opts.crashAfter === "persist-evidence") throw new InjectedCrash("persist-evidence");
      const fetchRev = await pool.query<{ evidence_revision: number }>(
        `SELECT evidence_revision FROM runs WHERE id = $1`,
        [runId],
      );
      await checkpoint(pool, runId, Number(fetchRev.rows[0]?.evidence_revision ?? 0), "researching", {
        action: "fetch",
        locator,
      });
      continue;
    }

    // synthesize or stop
    await setPhase(pool, runId, "writing");
    await emitEvent(pool, {
      runId,
      accountId: run.account_id,
      type: "writing",
      summary: "Drafting a bounded cited report from stored evidence.",
      phase: "writing",
    });
    if (opts.pauseAt === "writing") return;

    const latest = await getRun(pool, runId);
    if (!latest) return;
    if (latest.cancellation_epoch > 0 || latest.lifecycle === "cancelling") {
      await withTx(pool, async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, latest.account_id, runId, latest.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: latest.account_id,
          type: "cancelled",
          summary: "Cancelled during writing. Late publication is rejected.",
          phase: "writing",
        });
      });
      return;
    }
    if (await isDeleted(pool, latest.account_id)) {
      await markTerminal(pool, runId, "cancelled");
      return;
    }

    const evidence2 = await loadEvidence(pool, runId);
    const brief2 = await getBrief(pool, latest.brief_id);
    const state2 = toState(latest, brief2, evidence2, false, canaries);
    state2.basis.workerLeaseFence = fence;
    state2.phase = "writing";
    const reportId = crypto.randomUUID();
    const report = composeReport(state2, reportId);
    report.routeMode = latest.route_mode as typeof report.routeMode;
    const claims: StoredClaim[] = state2.claims;
    const passages: StoredPassage[] = state2.passages;

    if (opts.crashAfter === "before-publish") throw new InjectedCrash("before-publish");

    await addSpent(pool, runId, FIXTURE_SYNTH_COST_MICRO);
    const result = await withTx(pool, async (c) => {
      return publishReport(c, {
        report,
        accountId: latest.account_id,
        loaded: state2.basis,
        claims,
        passages,
        deleted: await isDeleted(c, latest.account_id),
      });
    });
    await emitEvent(pool, {
      runId,
      accountId: latest.account_id,
      type: result.accepted ? "published" : "publication_rejected",
      summary: result.accepted
        ? "Report published from stored evidence IDs."
        : `Publication rejected (${result.reason}).`,
      phase: "writing",
      payload: { reason: result.reason, reportId: result.reportId },
    });
    if (result.accepted) return;
    if (result.reason === "cancelled" || result.reason === "deleted" || result.reason === "stale_lease") {
      await markTerminal(pool, runId, "cancelled");
      return;
    }
    await markTerminal(pool, runId, "failed");
    return;
  }
}
