import { setPendingInput } from "../modules/runs.js";
import {
  DEFAULT_RUN_BUDGET_MICRO,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
  LIVE_CALL_RESERVE_MICRO,
} from "@deep/contracts";
import {
  admitProposedAction,
  admitExecutableAction,
  compactForContext,
  composeReport,
  detectContradictions,
  detectGaps,
  deriveResearchQuestions,
  evaluateDisconfirmation,
  extractCandidates,
  planDisconfirmation,
  selectAdaptiveAction,
  selectBaselineAction,
  selectNextAction,
  type ControllerState,
  type StoredClaim,
  type StoredPassage,
} from "@deep/research-core";
import { fixtureProposeAction } from "../adapters/model/fixture.js";
import { fixtureFetch, fixtureSearch, type SearchHit } from "../adapters/retrieval/fixture.js";
import { liveWebSearch } from "../adapters/retrieval/live-web.js";
import { reserveLiveAttempt, liveSpendUsedMicro } from "../modules/live-spend.js";
import { providerFailureState } from "../adapters/model/outcomes.js";
import { readSource } from "../adapters/retrieval/read-source.js";
import type { AppConfig } from "../platform/config.js";
import { withTx, type Queryable } from "../platform/db.js";
import { logInfo } from "../platform/log.js";
import { consentAllowsProcessing } from "../modules/access.js";
import { recordIntent, settleRun, updateIntentState } from "../modules/billing.js";
import { insertSource, insertVersionAndPassage, insertExtractedVersion, loadEvidence } from "../modules/evidence.js";
import { publishReport } from "../modules/reports.js";
import { researchPublicationLimitations } from "../modules/publication-coverage.js";
import { counterevidenceLimitations } from "../modules/counterevidence.js";
import { evidenceSelectionLimitations } from "../modules/evidence-selections.js";
import {
  addSpent,
  bumpEvidence,
  checkpoint,
  emitEvent,
  getBrief,
  getRun,
  listEvents,
  markTerminal,
  setPhase,
} from "../modules/runs.js";
import { createHash } from "node:crypto";
import pg from "pg";
import { ingestAttachments } from "./attachment-ingestion.js";
import { fencedSession } from "./fenced-session.js";

import { InjectedCrash, type ProcessOptions } from "./execution-options.js";
export { InjectedCrash } from "./execution-options.js";
import { executeLeasedRun, prepareRunStep } from "./run-lifecycle.js";

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
    issuedDedupeKeys: searchEvents
      .map((e) => (e.payload as { dedupeKey?: string } | null)?.dedupeKey)
      .filter((k): k is string => Boolean(k)),
    completedActionTypes: searchEvents
      .map((e) => e.type)
      .filter((t) => t === "compare" || t === "calculate" || t === "verify" || t === "replan" || t === "extract_text" || t === "challenge"),
    stopReason: searchEvents.find((e) => e.type === "stop_policy")?.public_summary,
    lastPivotReason: searchEvents.find((e) => e.type === "source_pivot")?.public_summary,
    disconfirmations: searchEvents
      .filter((e) => e.type === "challenge" || e.type === "disconfirm")
      .map((e) => {
        const p = (e.payload ?? {}) as {
          targetConclusion?: string;
          falsificationHypothesis?: string;
          searchStrategy?: string;
          result?: "counterevidence_found" | "no_counterexample_found" | "untried";
          counterevidenceFound?: boolean;
          impact?: string;
        };
        return {
          id: p.targetConclusion ?? e.type,
          targetConclusion: p.targetConclusion ?? "",
          falsificationHypothesis: p.falsificationHypothesis ?? "",
          searchStrategy: p.searchStrategy ?? "",
          result: p.result ?? "untried",
          counterevidenceFound: Boolean(p.counterevidenceFound),
          impact: p.impact ?? e.public_summary,
        };
      }),
    controllerVersion: "research-controller.v1",
  };
  state.questions = deriveResearchQuestions(state);
  state.contradictions = detectContradictions(state);
  state.gaps = detectGaps(state);
  return state;
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

/** Historical bounded controller for explicit development diagnostics only. */
export async function processRun(pool: pg.Pool, config: AppConfig, runId: string, opts: ProcessOptions = {}): Promise<void> {
  if(config.nodeEnv === "production" || config.authMode === "production") throw new Error("diagnostic_worker_forbidden");
  const run=await getRun(pool,runId);
  if(!run || (run.route_mode === "fixture" && !config.fixtureRouteAllowed) ||
    (run.route_mode === "controlled-research" && (!config.liveRouteEnabled || config.structuredModelEnabled))) return;
  await executeLeasedRun(pool,config,runId,opts,(fence,session)=>processOwnedRun(pool,config,runId,opts,fence,session));
}

async function processOwnedRun(pool: pg.Pool, config: AppConfig, runId: string, opts: ProcessOptions,
  fence: number, session: ReturnType<typeof fencedSession>): Promise<void> {
  const declinedOffCoverage = new Set<string>();

  for (let step = 0; step < 16; step++) {
    const run = await prepareRunStep(pool,runId,fence,session);
    if(!run)return;
    const deleted = false; // prepareRunStep rejects deleted accounts before controller work.

    const brief = await getBrief(pool, run.brief_id);
    await ingestAttachments(pool, run, brief, session);
    const evidence = await loadEvidence(pool, runId);
    const canaries = await privateCanaries(pool, run.account_id);
    const ev = await listEvents(pool, runId, 0);
    const state = toState(run, brief, evidence, deleted, canaries, ev);
    // Keep lease fence from claim, not a stale load.
    state.basis.workerLeaseFence = fence;

    if (run.phase === "writing" && opts.pauseAt === "writing") {
      return;
    }

    const seenDedupe = new Set<string>([...declinedOffCoverage, ...(state.issuedDedupeKeys ?? [])]);
    let decision = fixtureProposeAction(state);
    if (run.route_mode === "controlled-research" && config.liveRouteEnabled && !decision.rejectReason) {
      const liveProposed =
        config.liveControllerKind === "baseline" ? selectBaselineAction(state) : selectAdaptiveAction(state);
      liveProposed.actionId = `live-${step}`;
      liveProposed.dedupeKey = `live-${runId}-${step}-${liveProposed.type}`;
      const usedMicro = await liveSpendUsedMicro(pool, config.liveBudgetScope);
      const livePaid = liveProposed.type === "search" || liveProposed.type === "challenge";
      decision = admitProposedAction(state, liveProposed, {
        seenDedupeKeys: seenDedupe,
        liveSpend: {
          capMicro: config.liveSpendCapMicro,
          usedMicro,
          estimatedMicro: livePaid ? LIVE_CALL_RESERVE_MICRO : 0,
        },
      });
    }

    // Retrieved gossip/bait must be declined without skipping inspection of remaining sources.
    if (decision.rejectReason === "off_coverage") {
      if (!declinedOffCoverage.has(decision.dedupeKey)) {
        await session.write((c) => emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "action_rejected",
          summary: decision.rationale,
          phase: run.phase,
          payload: { reason: decision.rejectReason },
        }));
        declinedOffCoverage.add(decision.dedupeKey);
      }
      decision = admitProposedAction(state, selectNextAction(state), { seenDedupeKeys: seenDedupe });
    }

    logInfo("action", { runId, type: decision.type, rationale: decision.rationale, step });

    const challengeSearch = decision.type === "challenge" && decision.arguments.query && !decision.arguments.recordOnly;
    if (challengeSearch) {
      decision = admitExecutableAction(state, decision, {
        seenDedupeKeys: seenDedupe,
        liveSpend: run.route_mode === "controlled-research" ? {
          capMicro: config.liveSpendCapMicro, usedMicro: await liveSpendUsedMicro(pool, config.liveBudgetScope),
          estimatedMicro: LIVE_CALL_RESERVE_MICRO,
        } : undefined,
      });
    }

    if (decision.type === "clarify") {
      await session.write(async (c) => {
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
        await setPendingInput(c, { runId, accountId: run.account_id, briefRevision: run.brief_revision, type: "clarification" });
      });
      return;
    }

    if (decision.type === "search") {
      const query = String(decision.arguments.query ?? brief.originalQuestion);
      let hits: SearchHit[] = [];
      let searchRoute = "fixture:search";
      if (run.route_mode === "controlled-research" && config.liveRouteEnabled) {
        const digest = createHash("sha256").update(JSON.stringify({ query: query.trim(), model: config.openRouterModel, revision: run.brief_revision })).digest("hex");
        let intentId: string | undefined;
        let receiptRecorded = false;
        try {
          const attempt = await reserveLiveAttempt(pool, config, {
            runId, fence, briefRevision: run.brief_revision, logicalKey: `search:${digest}`,
            kind: "search", route: `openrouter:${config.openRouterModel}:web`, requestDigest: digest,
            reserveMicro: LIVE_CALL_RESERVE_MICRO,
          });
          intentId = attempt.intentId;
          if (attempt.issue) {
            const live = await liveWebSearch(query, config, session.signal);
            await withTx(pool, async (db) => {
              await updateIntentState(db, intentId!, live.receipt.state, live.receipt.actualMicro);
              await db.query("UPDATE provider_intents SET receipt = $2 WHERE id = $1", [intentId, JSON.stringify(live.receipt)]);
            });
            receiptRecorded = true;
            if (live.receipt.state !== "confirmed") throw new Error("search_result_unresolved");
            hits = live.hits;
            searchRoute = live.receipt.route;
          } else {
            // A financial receipt is not a durable search result. Without stored
            // output, replay must neither resend nor invent an empty success.
            receiptRecorded = true;
            throw new Error("search_result_unresolved");
          }
        } catch (error) {
          if (intentId && !receiptRecorded) await updateIntentState(pool, intentId, providerFailureState(error as Error));
          const message = error instanceof Error ? error.message : "";
          const reason = ["run_spend_cap_exhausted", "missing_active_run_allowance", "live_spend_cap_exhausted", "live_spend_cap_zero", "invalid_live_budget", "missing_provider_key", "provider_key_cap_exhausted"]
            .includes(message) ? message : intentId ? "provider_outcome_unresolved" : "provider_admission_failed";
          await session.write(async (db) => {
            await emitEvent(db, { runId, accountId: run.account_id, type: intentId ? "search_unresolved" : "search_blocked",
              phase: "researching", summary: "Search could not complete. No search result is claimed.", payload: { reason } });
            await markTerminal(db, runId, "failed");
            await settleRun(db, run.account_id, runId, run.spent_micro);
          });
          return;
        }
      } else {
        hits = fixtureSearch(query);
      }
      const evidenceRev = await session.write(async (c) => {
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
        if (run.route_mode === "fixture") {
        await addSpent(c, runId, FIXTURE_SEARCH_COST_MICRO);
        await recordIntent(c, runId, {
          correlationId: decision.actionId,
          route: searchRoute,
          digest: query,
          reserved: FIXTURE_SEARCH_COST_MICRO,
          state: "confirmed",
        });
        }
        await emitEvent(c, {
          runId,
          accountId: run.account_id,
          type: "searched",
          summary: `Searched: ${query.slice(0, 160)}`,
          phase: "researching",
          payload: {
            locators: hits.map((h) => h.locator),
            pivot: Boolean(decision.arguments.pivot),
            trigger: decision.arguments.trigger,
            sourceTypeNeeded: decision.arguments.sourceTypeNeeded,
            dedupeKey: decision.dedupeKey,
            gapId: decision.gapId,
          },
        });
        if (decision.arguments.pivot) {
          await emitEvent(c, {
            runId,
            accountId: run.account_id,
            type: "source_pivot",
            summary: decision.rationale,
            phase: "researching",
            payload: {
              reason: decision.rationale,
              trigger: decision.arguments.trigger,
              sourceTypeNeeded: decision.arguments.sourceTypeNeeded,
              gapId: decision.gapId,
              pivotReason: decision.arguments.pivotReason ?? decision.rationale,
              selectionReason: decision.arguments.selectionReason,
            },
          });
        }
        if (decision.arguments.disconfirm || challengeSearch) {
          await emitEvent(c, {
            runId,
            accountId: run.account_id,
            type: "disconfirm_search",
            summary: `Disconfirm search: ${query.slice(0, 160)}`,
            phase: "researching",
            payload: {
              query,
              targetConclusion: decision.arguments.targetConclusion,
              falsificationHypothesis: decision.arguments.falsificationHypothesis,
              result: "untried",
              selectionReason: decision.arguments.selectionReason,
            },
          });
        }
        await setPhase(c, runId, "researching");
        return rev;
      });
      if (opts.crashAfter === "persist-evidence") throw new InjectedCrash("persist-evidence");
      await session.write((c) => checkpoint(c, runId, evidenceRev, "researching", { action: "search", query }));
      continue;
    }

    if (decision.type === "fetch") {
      const locator = String(decision.arguments.locator ?? "");
      if (run.route_mode !== "fixture") {
        const sourceId = await session.write(async (c) => {
          const supplied = String(decision.arguments.sourceId ?? "");
          const owned = await c.query<{ id: string }>(`SELECT id FROM sources WHERE run_id=$1 AND account_id=$2 AND canonical_locator=$3 AND ($4='' OR id::text=$4)`,
            [runId,run.account_id,locator,supplied]);
          if (supplied && !owned.rows.length) throw new Error("source_owner_or_locator_mismatch");
          return owned.rows[0]?.id ?? insertSource(c, { accountId: run.account_id, runId, locator,
            title: locator, publisher: new URL(locator).host, originCluster: locator });
        });
        const read = config.liveRetrievalEnabled ? await readSource(locator, session.signal) : {
          receipt: { requestedUrl: locator, finalUrl: locator, redirectChain: [], status: null,
            mime: "application/octet-stream", retrievedAt: new Date().toISOString(), outcome: "fetch_unavailable" as const },
        };
        await session.write(async (c) => {
          const versionId = await insertExtractedVersion(c, { accountId: run.account_id, runId, sourceId, ...read });
          const revision = await bumpEvidence(c, runId);
          await emitEvent(c, { runId, accountId: run.account_id, type: "opened_source", phase: "researching",
            summary: read.receipt.outcome === "successful_body" ? "Extracted source blocks; coverage remains partial." : "Source reading unavailable.",
            payload: { sourceId, versionId, outcome: read.receipt.outcome } });
          await checkpoint(c, runId, revision, "researching", { action: "fetch", sourceId, versionId });
        });
        if (opts.crashAfter === "persist-evidence") throw new InjectedCrash("persist-evidence");
        continue;
      }
      const doc = fixtureFetch(locator);
      await session.write(async (c) => {
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
        if (run.route_mode === "fixture") {
        await addSpent(c, runId, FIXTURE_FETCH_COST_MICRO);
        await recordIntent(c, runId, {
          correlationId: decision.actionId,
          route: "fixture:fetch",
          digest: locator,
          reserved: FIXTURE_FETCH_COST_MICRO,
          state: "confirmed",
        });
        }
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
      await session.write((c) => checkpoint(c, runId, Number(fetchRev.rows[0]?.evidence_revision ?? 0), "researching", {
        action: "fetch",
        locator,
      }));
      continue;
    }

    if (decision.type === "compare" || decision.type === "calculate" || decision.type === "verify" || decision.type === "replan" || decision.type === "extract_text" || decision.type === "challenge") {
      const planned = decision.type === "challenge" ? planDisconfirmation(state) : null;
      const evaluated = planned ? evaluateDisconfirmation(state, planned) : null;
      await session.write((c) => emitEvent(c, {
        runId,
        accountId: run.account_id,
        type: decision.type,
        summary: evaluated?.impact ?? decision.rationale,
        phase: "researching",
        payload: {
          ...decision.arguments,
          ...(evaluated ?? {}),
          dedupeKey: decision.dedupeKey,
          gapId: decision.gapId,
        },
      }));
      await session.write((c) => checkpoint(c, runId, run.evidence_revision, "researching", { action: decision.type }));
      continue;
    }

    if (decision.rejectReason) {
      await session.write((c) => emitEvent(c, {
        runId,
        accountId: run.account_id,
        type: "action_rejected",
        summary: decision.rationale,
        phase: run.phase,
        payload: { reason: decision.rejectReason },
      }));
    }

    if (decision.type === "stop" || decision.arguments?.stopPolicy || decision.arguments?.reason) {
      await session.write((c) => emitEvent(c, {
        runId,
        accountId: run.account_id,
        type: "stop_policy",
        summary: decision.rationale,
        phase: run.phase,
        payload: {
          reason: decision.arguments?.reason ?? decision.rejectReason ?? "stop",
          stopPolicy: decision.arguments?.stopPolicy ?? decision.arguments?.reason,
        },
      }));
    }

    // synthesize or stop — persist writing before compose so clients can cancel during writing.
    await session.write((c) => setPhase(c, runId, "writing"));
    await session.write((c) => emitEvent(c, {
      runId,
      accountId: run.account_id,
      type: "writing",
      summary: "Drafting a bounded cited report from stored evidence.",
      phase: "writing",
    }));
    await session.write((c) => checkpoint(c, runId, run.evidence_revision, "writing", { action: "enter-writing" }));
    if (opts.pauseAt === "writing") return;
    if (config.writingCancelWindowMs > 0) {
      await new Promise((r) => setTimeout(r, config.writingCancelWindowMs));
    }

    const latest = await getRun(pool, runId);
    if (!latest) return;
    if (latest.cancellation_epoch > 0 || latest.lifecycle === "cancelling") {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, latest.account_id, runId, latest.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: latest.account_id,
          type: "cancelled",
          summary: "Cancelled during writing. Late publication is rejected.",
          phase: "writing",
        });
      }, true);
      return;
    }
    if (await isDeleted(pool, latest.account_id)) {
      await session.write((c) => markTerminal(c, runId, "cancelled"), true);
      return;
    }
    if (!(await consentAllowsProcessing(pool, latest.account_id))) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, latest.account_id, runId, latest.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: latest.account_id,
          type: "cancelled",
          summary: "Consent revoked during writing. Late publication is rejected.",
          phase: "writing",
        });
      }, true);
      return;
    }

    const evidence2 = await loadEvidence(pool, runId);
    const brief2 = await getBrief(pool, latest.brief_id);
    const ev2 = await listEvents(pool, runId, 0);
    const state2 = toState(latest, brief2, evidence2, false, canaries, ev2);
    state2.basis.workerLeaseFence = fence;
    state2.phase = "writing";
    const compacted = compactForContext(state2);
    await session.write((c) => checkpoint(c, runId, latest.evidence_revision, "writing", { compact: compacted }));
    const reportId = crypto.randomUUID();
    const report = composeReport(state2, reportId);
    report.routeMode = latest.route_mode as typeof report.routeMode;
    for (const c of state2.candidates) {
      await session.write((db) => db.query(
        `INSERT INTO candidates (id, run_id, identity, discovered_from, excluded_by) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), runId, c.identity, c.id, c.excludedBy ?? null],
      ));
    }
    await session.write((c) => c.query(`DELETE FROM evidence_gaps WHERE run_id = $1`, [runId]));
    for (const g of state2.gaps) {
      await session.write((c) => c.query(
        `INSERT INTO evidence_gaps (id, run_id, missing_fact, why_it_could_change_answer, importance, source_type_needed, latest_outcome, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          crypto.randomUUID(),
          runId,
          g.missingFact,
          g.whyItCouldChangeAnswer,
          g.importance,
          g.sourceTypeNeeded ?? null,
          g.latestOutcome ?? null,
          JSON.stringify({
            dependentConclusion: g.dependentConclusion ?? null,
            resolvingEvidence: g.resolvingEvidence ?? null,
            remainingUncertainty: g.remainingUncertainty ?? null,
            attempts: g.attempts ?? [],
            gapId: g.id,
            preferredSourceTypes: g.preferredSourceTypes ?? [],
            questionId: g.questionId ?? null,
            resolution: g.resolution ?? null,
          }),
        ],
      ));
    }
    await session.write((c) => c.query(`DELETE FROM research_contradictions WHERE run_id = $1`, [runId]));
    for (const c of state2.contradictions ?? []) {
      await session.write((db) => db.query(
        `INSERT INTO research_contradictions (id, run_id, payload, resolution_status) VALUES ($1,$2,$3,$4)`,
        [crypto.randomUUID(), runId, JSON.stringify(c), c.resolutionStatus],
      ));
    }
    await session.write((c) => c.query(`DELETE FROM research_disconfirmations WHERE run_id = $1`, [runId]));
    for (const d of state2.disconfirmations ?? []) {
      await session.write((c) => c.query(`INSERT INTO research_disconfirmations (id, run_id, payload) VALUES ($1,$2,$3)`, [
        crypto.randomUUID(),
        runId,
        JSON.stringify(d),
      ]));
    }
    await session.write((c) => c.query(`UPDATE runs SET controller_kind = $2, controller_artifacts = $3 WHERE id = $1`, [
      runId,
      latest.route_mode === "controlled-research" ? (config.liveControllerKind ?? "adaptive") : "adaptive",
      JSON.stringify({
        questions: state2.questions ?? [],
        stopReason: state2.stopReason ?? null,
        lastPivotReason: state2.lastPivotReason ?? null,
        controllerVersion: "research-controller.v1",
      }),
    ]));
    const extraLimitations = await session.write(async (db) => {
      const challengeBasis = { runId, accountId: latest.account_id, briefRevision: latest.brief_revision };
      return [
        ...await researchPublicationLimitations(db, challengeBasis),
        ...await counterevidenceLimitations(db, challengeBasis),
        ...await evidenceSelectionLimitations(db, { ...challengeBasis, evidenceRevision: latest.evidence_revision }),
      ];
    });
    for (const limitation of extraLimitations) {
      if (!report.limitations.includes(limitation)) report.limitations.push(limitation);
    }
    if (report.limitations.length && report.outcome === "completed") report.outcome = "completed_with_limitations";
    const claims: StoredClaim[] = state2.claims;
    const passages: StoredPassage[] = state2.passages;

    if (opts.crashAfter === "before-publish") throw new InjectedCrash("before-publish");

    const prePublish = await getRun(pool, runId);
    if (!prePublish) return;
    if (prePublish.cancellation_epoch > 0 || prePublish.lifecycle === "cancelling") {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, prePublish.account_id, runId, prePublish.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: prePublish.account_id,
          type: "cancelled",
          summary: "Cancelled during writing. Late publication is rejected.",
          phase: "writing",
        });
      }, true);
      return;
    }
    if (!(await consentAllowsProcessing(pool, prePublish.account_id))) {
      await session.write(async (c) => {
        await markTerminal(c, runId, "cancelled");
        await settleRun(c, prePublish.account_id, runId, prePublish.spent_micro);
        await emitEvent(c, {
          runId,
          accountId: prePublish.account_id,
          type: "cancelled",
          summary: "Consent revoked during writing. Late publication is rejected.",
          phase: "writing",
        });
      }, true);
      return;
    }
    state2.basis.cancellationEpoch = prePublish.cancellation_epoch;
    state2.basis.workerLeaseFence = fence;

    if (latest.route_mode === "fixture") {
    await session.write((c) => addSpent(c, runId, FIXTURE_SYNTH_COST_MICRO));
    await session.write((c) => recordIntent(c, runId, {
      correlationId: reportId,
      route: "fixture:synthesize",
      digest: "compose-report",
      reserved: FIXTURE_SYNTH_COST_MICRO,
      state: "confirmed",
    }));
    }
    const result = await session.write(async (c) => {
      const result = await publishReport(c, {
        report,
        accountId: latest.account_id,
        loaded: state2.basis,
        claims,
        passages,
        deleted: await isDeleted(c, latest.account_id),
      });
    await emitEvent(c, {
      runId,
      accountId: latest.account_id,
      type: result.accepted ? "published" : "publication_rejected",
      summary: result.accepted
        ? "Report published from stored evidence IDs."
        : `Publication rejected (${result.reason}).`,
      phase: "writing",
      payload: { reason: result.reason, reportId: result.reportId },
    });
      return result;
    });
    if (result.accepted) return;
    if (
      result.reason === "cancelled" ||
      result.reason === "deleted" ||
      result.reason === "stale_lease" ||
      result.reason === "consent_revoked"
    ) {
      await session.write((c) => markTerminal(c, runId, "cancelled"), true);
      return;
    }
    await session.write((c) => markTerminal(c, runId, "failed"));
    return;
  }
  await session.write(async (db) => {
    const run = await getRun(db, runId);
    if (!run) return;
    await emitEvent(db, { runId, accountId: run.account_id, type: "step_limit", phase: run.phase,
      summary: "Research reached its execution limit. Stored evidence is retained; no complete answer was published." });
    await markTerminal(db, runId, "failed");
    await settleRun(db, run.account_id, runId, run.spent_micro);
  });
}
