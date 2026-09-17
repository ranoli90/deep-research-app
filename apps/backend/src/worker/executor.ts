import {
  DEFAULT_RUN_BUDGET_MICRO,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
  LIVE_CALL_RESERVE_MICRO,
} from "@deep/contracts";
import {
  authorizeAction,
  compactForContext,
  composeReport,
  detectGaps,
  extractCandidates,
  selectNextAction,
  type ControllerState,
  type StoredClaim,
  type StoredPassage,
} from "@deep/research-core";
import { fixtureProposeAction } from "../adapters/model/fixture.js";
import { fixtureFetch, fixtureSearch, type SearchHit } from "../adapters/retrieval/fixture.js";
import { liveWebSearch } from "../adapters/retrieval/live-web.js";
import { assertLiveCallAllowed } from "../modules/live-spend.js";
import { nextLiveAction } from "./live-policy.js";
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
  listEvents,
  markTerminal,
  setPhase,
} from "../modules/runs.js";
import { createHash } from "node:crypto";
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
  searchEvents: { type: string; public_summary: string; payload: unknown }[],
): ControllerState {
  const sources = evidence.sources.map((s) => ({
    id: s.id,
    title: s.title,
    locator: s.canonical_locator,
    accessLevel: s.access_level,
    originCluster: s.origin_cluster ?? undefined,
    sourceFamily: s.origin_cluster ?? undefined,
    sourceType: s.source_type ?? undefined,
    population: s.population ?? undefined,
    language: s.language ?? undefined,
  }));
  const passages: StoredPassage[] = evidence.passages.map((p) => ({
    id: p.id,
    sourceId: p.source_id,
    sourceVersionId: p.source_version_id,
    exactText: p.exact_text,
    locator: "document",
  }));
  const seen = new Set<string>();
  const searches = searchEvents
    .filter((e) => e.type === "searched")
    .map((e) => {
      const locators = ((e.payload as { locators?: string[] } | null)?.locators ?? []) as string[];
      const families = locators.map((l) => l.split("/").slice(0, 3).join("/"));
      let newFamilies = 0;
      for (const f of families) {
        if (!seen.has(f)) {
          seen.add(f);
          newFamilies += 1;
        }
      }
      return {
        query: e.public_summary.replace(/^Searched:\s*/, ""),
        sourceFamilyIds: families,
        newFamilies,
        coverageProgress: newFamilies > 0,
      };
    });
  const correctionTail = brief.originalQuestion.split("Correction:")[1] ?? "";
  const state: ControllerState = {
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
        status: (() => {
          const publicPassages = passages.filter((p) => {
            const src = sources.find((s) => s.id === p.sourceId);
            return src && !String(src.locator).startsWith("attachment://");
          });
          if (publicPassages.length) return "supported";
          if (sources.length) return "investigating";
          return "unstarted";
        })(),
      },
    ],
    gaps: [],
    searches,
    constraints: brief.constraints,
    candidates: extractCandidates(passages, brief.constraints).map((c) => ({
      id: c.id,
      identity: c.identity,
      excludedBy: c.excludedBy,
      feasibility: c.feasibility,
    })),
    spentMicro: run.spent_micro,
    budgetMicro: run.budget_micro || DEFAULT_RUN_BUDGET_MICRO,
    deleted,
    privateCanaries,
    reopenedDiscovery: Boolean(run.parent_run_id) && /budget/i.test(correctionTail),
    dependencyCompleteness: /unknown/i.test(correctionTail) ? "unknown" : run.parent_run_id ? "partial" : "known",
  };
  state.gaps = detectGaps(state);
  return state;
}

async function isDeleted(db: Queryable, accountId: string): Promise<boolean> {
  const res = await db.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM accounts WHERE id = $1`, [accountId]);
  return Boolean(res.rows[0]?.deleted_at);
}

async function ingestAttachments(
  pool: pg.Pool,
  run: { id: string; account_id: string },
  brief: { attachmentIds: string[] },
): Promise<void> {
  for (const id of brief.attachmentIds ?? []) {
    const row = await pool.query<{
      filename: string;
      mime: string;
      extracted_text: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT filename, mime, extracted_text, deleted_at FROM attachments WHERE id = $1 AND account_id = $2`,
      [id, run.account_id],
    );
    const att = row.rows[0];
    if (!att || att.deleted_at || !att.extracted_text) continue;
    const locator = `attachment://${id}`;
    const exists = await pool.query(`SELECT 1 FROM sources WHERE run_id = $1 AND canonical_locator = $2`, [run.id, locator]);
    if ((exists.rowCount ?? 0) > 0) continue;
    await withTx(pool, async (c) => {
      const sourceId = await insertSource(c, {
        accountId: run.account_id,
        runId: run.id,
        locator,
        title: att.filename,
        publisher: "uploaded",
        originCluster: locator,
        sourceType: "supplied-document",
      });
      await insertVersionAndPassage(c, {
        sourceId,
        accountId: run.account_id,
        runId: run.id,
        locator,
        text: att.extracted_text!,
        accessLevel: att.mime === "application/pdf" ? "partial-text" : "full-text",
      });
      await bumpEvidence(c, run.id);
    });
  }
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
  const peek = await getRun(pool, runId);
  if (peek?.route_mode === "controlled-research" && !config.liveRouteEnabled) {
    logInfo("skip_live_job", { runId, reason: "fixture_worker_cannot_run_live_route" });
    return;
  }
  const fence = await withTx(pool, async (c) => claimLease(c, runId, workerId, config.leaseMs));
  if (fence == null) return;
  const declinedOffCoverage = new Set<string>();

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
    await ingestAttachments(pool, run, brief);
    const evidence = await loadEvidence(pool, runId);
    const canaries = await privateCanaries(pool, run.account_id);
    const ev = await listEvents(pool, runId, 0);
    const state = toState(run, brief, evidence, deleted, canaries, ev);
    // Keep lease fence from claim, not a stale load.
    state.basis.workerLeaseFence = fence;

    if (run.phase === "writing" && opts.pauseAt === "writing") {
      return;
    }

    let decision = fixtureProposeAction(state);
    if (run.route_mode === "controlled-research" && config.liveRouteEnabled) {
      const liveNext = nextLiveAction(state);
      decision = {
        actionId: `live-${step}`,
        runId,
        briefRevision: state.brief.revision,
        type: liveNext.type,
        coverageIds: [],
        arguments: { query: liveNext.query, locator: liveNext.locator, sourceId: liveNext.sourceId },
        rationale: liveNext.rationale,
        estimatedMaxCostMicro: liveNext.type === "search" ? LIVE_CALL_RESERVE_MICRO : 0,
        sourceAccessConstraints: [],
        dedupeKey: `live-${runId}-${step}-${liveNext.type}`,
        privileged: false,
      };
    }

    // Retrieved gossip/bait must be declined without skipping inspection of remaining sources.
    if (decision.rejectReason === "off_coverage") {
      if (!declinedOffCoverage.has(decision.dedupeKey)) {
        await emitEvent(pool, {
          runId,
          accountId: run.account_id,
          type: "action_rejected",
          summary: decision.rationale,
          phase: run.phase,
          payload: { reason: decision.rejectReason },
        });
        declinedOffCoverage.add(decision.dedupeKey);
      }
      decision = authorizeAction(state, selectNextAction(state));
    }

    logInfo("action", { runId, type: decision.type, rationale: decision.rationale, step });

    if (decision.type === "clarify") {
      await withTx(pool, async (c) => {
        await setPhase(c, runId, "preparing");
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "clarify",
          summary: (() => {
            const raw = decision.arguments.questions;
            const first = Array.isArray(raw) ? raw[0] : raw;
            return String(first ?? "Which jurisdiction should this answer apply to?");
          })(),
          phase: "preparing",
          payload: decision.arguments,
        });
        await c.query(`UPDATE runs SET lifecycle = 'awaiting_input' WHERE id = $1`, [runId]);
      });
      return;
    }

    if (decision.type === "search") {
      const query = String(decision.arguments.query ?? brief.originalQuestion);
      let hits: SearchHit[] = [];
      let searchRoute = "fixture:search";
      if (run.route_mode === "controlled-research" && config.liveRouteEnabled) {
        try {
          await assertLiveCallAllowed(pool, config);
          const live = await liveWebSearch(query, config);
          await recordIntent(pool, runId, {
            correlationId: live.receipt.correlationId,
            route: live.receipt.route,
            digest: live.receipt.requestDigest,
            reserved: LIVE_CALL_RESERVE_MICRO,
            state: live.receipt.state,
          });
          hits = live.hits;
          searchRoute = live.receipt.route;
        } catch {
          hits = [];
          searchRoute = "openrouter:blocked-by-spend-cap";
        }
      } else {
        hits = fixtureSearch(query);
      }
      const evidenceRev = await withTx(pool, async (c) => {
        const existing = await c.query<{ canonical_locator: string }>(
          `SELECT canonical_locator FROM sources WHERE run_id = $1`,
          [runId],
        );
        const have = new Set(existing.rows.map((r) => r.canonical_locator));
        for (const hit of hits) {
          if (have.has(hit.locator)) continue;
          const sourceId = await insertSource(c, {
            accountId: run.account_id,
            runId,
            locator: hit.locator,
            title: hit.title,
            publisher: hit.publisher,
            originCluster: hit.originCluster,
            sourceType: hit.sourceType,
            population: hit.population,
            language: hit.language,
          });
          if (hit.snippet) {
            await insertVersionAndPassage(c, {
              sourceId,
              accountId: run.account_id,
              runId,
              locator: hit.locator,
              text: hit.snippet,
              accessLevel: "snippet",
            });
          }
        }
        const rev = await bumpEvidence(c, runId);
        await addSpent(c, runId, FIXTURE_SEARCH_COST_MICRO);
        await recordIntent(c, runId, {
          correlationId: decision.actionId,
          route: searchRoute,
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
            sourceType: doc.sourceType,
            population: doc.population,
            language: doc.language,
          }));
        }
        const hash = createHash("sha256").update(doc.text).digest("hex");
        const last = await c.query<{ content_hash: string; access_level: string }>(
          `SELECT content_hash, access_level FROM source_versions WHERE source_id = $1 ORDER BY retrieved_at DESC LIMIT 1`,
          [sourceId],
        );
        // Persist when text OR access level changes. A paywalled fetch often
        // returns the same snippet bytes with access_level=blocked.
        if (
          !last.rows[0] ||
          last.rows[0].content_hash !== hash ||
          last.rows[0].access_level !== doc.accessLevel
        ) {
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

    if (decision.rejectReason) {
      await emitEvent(pool, {
        runId,
        accountId: run.account_id,
        type: "action_rejected",
        summary: decision.rationale,
        phase: run.phase,
        payload: { reason: decision.rejectReason },
      });
    }

    // synthesize or stop — persist writing before compose so clients can cancel during writing.
    await setPhase(pool, runId, "writing");
    await emitEvent(pool, {
      runId,
      accountId: run.account_id,
      type: "writing",
      summary: "Drafting a bounded cited report from stored evidence.",
      phase: "writing",
    });
    await checkpoint(pool, runId, run.evidence_revision, "writing", { action: "enter-writing" });
    if (opts.pauseAt === "writing") return;
    if (config.writingCancelWindowMs > 0) {
      await new Promise((r) => setTimeout(r, config.writingCancelWindowMs));
    }

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
    const ev2 = await listEvents(pool, runId, 0);
    const state2 = toState(latest, brief2, evidence2, false, canaries, ev2);
    state2.basis.workerLeaseFence = fence;
    state2.phase = "writing";
    const compacted = compactForContext(state2);
    await checkpoint(pool, runId, latest.evidence_revision, "writing", { compact: compacted });
    const reportId = crypto.randomUUID();
    const report = composeReport(state2, reportId);
    report.routeMode = latest.route_mode as typeof report.routeMode;
    for (const c of state2.candidates) {
      await pool.query(
        `INSERT INTO candidates (id, run_id, identity, discovered_from, excluded_by) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), runId, c.identity, c.id, c.excludedBy ?? null],
      );
    }
    for (const g of state2.gaps) {
      await pool.query(
        `INSERT INTO evidence_gaps (id, run_id, missing_fact, why_it_could_change_answer, importance, source_type_needed, latest_outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [crypto.randomUUID(), runId, g.missingFact, g.whyItCouldChangeAnswer, g.importance, g.sourceTypeNeeded ?? null, g.latestOutcome ?? null],
      );
    }
    const claims: StoredClaim[] = state2.claims;
    const passages: StoredPassage[] = state2.passages;

    if (opts.crashAfter === "before-publish") throw new InjectedCrash("before-publish");

    const prePublish = await getRun(pool, runId);
    if (!prePublish) return;
    if (prePublish.cancellation_epoch > 0 || prePublish.lifecycle === "cancelling") {
      await withTx(pool, async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, prePublish.account_id, runId, prePublish.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: prePublish.account_id,
          type: "cancelled",
          summary: "Cancelled during writing. Late publication is rejected.",
          phase: "writing",
        });
      });
      return;
    }
    state2.basis.cancellationEpoch = prePublish.cancellation_epoch;
    state2.basis.workerLeaseFence = fence;

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
