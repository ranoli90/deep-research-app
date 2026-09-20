import type pg from "pg";
import type { ResearchModelOutput } from "@deep/contracts";
import {
  CONCLUSION_CHALLENGE_VERSION,
  counterevidenceOutcome,
  counterevidenceSearch,
  falsificationForConclusion,
  resolveScopedSupport,
  selectConsequentialConclusions,
  type ScopedSupportResult,
} from "@deep/research-core";
import type { AppConfig } from "../platform/config.js";
import { runModelVersions } from "../modules/run-model-policy.js";
import { getRun } from "../modules/runs.js";
import { loadSupportContext, type SupportArgs } from "../modules/scoped-support.js";
import {
  loadConclusionChallenges,
  persistConclusionChallenge,
} from "../modules/research-controller.js";
import { adoptSearchSources } from "../modules/search-sources.js";
import type { FencedSession } from "./fenced-session.js";
import { performPublicSearch } from "./public-search.js";
import { executeSourceRead } from "./source-reading.js";
import { performModelOperation } from "./model-gateway.js";

const CONCURRENT_SOURCE_READS = 3;

/** Persist and execute one challenge object per consequential conclusion. */
export async function executeConclusionChallenges(
  pool: pg.Pool,
  config: AppConfig,
  session: FencedSession,
  args: SupportArgs & { fence: number; supportIntentId: string },
  input: {
    task: ResearchModelOutput<"brief">;
    assertions: ResearchModelOutput<"extract_assertions">["assertions"];
    checks: ScopedSupportResult[];
    originalQuestion: string;
  },
) {
  const conclusions = selectConsequentialConclusions(input.task, input.assertions, input.checks);
  if (!conclusions.length) return { kind: "not_applicable" as const, reason: "no_consequential_conclusion" };
  for (const conclusion of conclusions) {
    const seed = falsificationForConclusion({
      conclusionKey: conclusion.conclusionKey,
      conclusionText: conclusion.conclusionText,
      originalQuestion: input.originalQuestion,
    });
    await session.write((db) => persistConclusionChallenge(db, {
      ...args,
      conclusionKey: conclusion.conclusionKey,
      conclusionText: conclusion.conclusionText,
      questionKey: conclusion.questionKey,
      wouldFalsify: seed.wouldFalsify,
      likelySourceClass: seed.likelySourceClass,
    }));
  }
  if (!config.structuredChallengeEnabled) {
    return { kind: "recorded" as const, version: CONCLUSION_CHALLENGE_VERSION, count: conclusions.length };
  }
  const existing = await session.write((db) => loadConclusionChallenges(db, args));
  for (const conclusion of conclusions) {
    const saved = existing.find((c) => c.conclusionKey === conclusion.conclusionKey);
    if (saved && (saved.state === "challenged" || saved.state === "unknown" || saved.state === "blocked" && saved.reason !== "document_search_requires_public_query_approval")) continue;
    const proposal = counterevidenceSearch(input.originalQuestion, [conclusion.questionKey]);
    const seed = falsificationForConclusion({
      conclusionKey: conclusion.conclusionKey,
      conclusionText: conclusion.conclusionText,
      originalQuestion: input.originalQuestion,
    });
    const finish = (state: "blocked" | "unknown" | "challenged", outcome: string | null, reason: string | null, extra?: { searchIntentId?: string; modelIntentId?: string; changedConclusion?: boolean | null }) =>
      session.write((db) => persistConclusionChallenge(db, {
        ...args,
        conclusionKey: conclusion.conclusionKey,
        conclusionText: conclusion.conclusionText,
        questionKey: conclusion.questionKey,
        wouldFalsify: seed.wouldFalsify,
        likelySourceClass: seed.likelySourceClass,
        challenged: state === "challenged",
        changedConclusion: extra?.changedConclusion ?? null,
        state,
        outcome,
        reason,
        searchIntentId: extra?.searchIntentId ?? null,
        modelIntentId: extra?.modelIntentId ?? null,
      }));
    if (!proposal) {
      await finish("blocked", "blocked", "counterevidence_query_too_long");
      continue;
    }
    if (!config.structuredDiscoveryEnabled || !config.liveRetrievalEnabled) {
      await finish("blocked", "blocked", "counterevidence_search_unavailable");
      continue;
    }
    let search: Awaited<ReturnType<typeof performPublicSearch>>;
    try {
      search = await performPublicSearch(pool, config, session, { ...args, proposal, sourceClass: seed.likelySourceClass });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "document_search_requires_public_query_approval") throw error;
      // The gateway persisted the exact outbound proof; the controller must pause, not mark this conclusion permanently blocked.
      return { kind: "permission_required" as const };
    }
    if (search.kind !== "search") {
      await finish(search.kind === "pending" ? "unknown" : "blocked", search.kind === "pending" ? "outcome_unknown" : "blocked", search.kind === "pending" ? "search_outcome_unknown" : search.reason);
      continue;
    }
    const sources = await session.write((db) => adoptSearchSources(db, { ...args, intentId: search.intentId }));
    for (let i = 0; i < sources.length; i += CONCURRENT_SOURCE_READS) {
      const batch = sources.slice(i, i + CONCURRENT_SOURCE_READS);
      await Promise.all(batch.map(async (sourceHandle) => {
        await executeSourceRead(config, session, {
          ...args,
          proposal: { rationale: "Read admitted per-conclusion challenge evidence.", action: { type: "fetch", sourceHandle, questionKeys: [conclusion.questionKey] } },
        });
      }));
    }
    const assertion = input.assertions.find((a) => a.key === conclusion.conclusionKey);
    const initial = input.checks.find((c) => c.claimKey === conclusion.conclusionKey);
    if (!assertion || !initial) {
      await finish("blocked", "unresolved_at_limit", "conclusion_target_unavailable", { searchIntentId: search.intentId });
      continue;
    }
    const versions = await session.write((db) => runModelVersions(db, args.runId));
    const basis = await session.write((db) => loadSupportContext(db, args, versions));
    const current = await getRun(pool, args.runId);
    const historical = (current?.evidence_revision ?? basis.evidenceRevision) > basis.evidenceRevision;
    const assessment = await performModelOperation(pool, config, session, {
      ...args,
      evidenceRevision: basis.evidenceRevision,
      historical,
      context: { ...basis.context, assertions: [assertion] },
      operation: "assess_support",
    });
    if (assessment.kind !== "result") {
      await finish(assessment.kind === "pending" ? "unknown" : "blocked", assessment.kind === "pending" ? "outcome_unknown" : "blocked", assessment.kind === "pending" ? "support_outcome_unknown" : assessment.reason, { searchIntentId: search.intentId });
      continue;
    }
    if (assessment.result.receipt.actualMicro === null || assessment.result.status !== "succeeded" || !assessment.result.output) {
      await finish(assessment.result.status === "outcome_unknown" || assessment.result.receipt.actualMicro === null ? "unknown" : "blocked",
        assessment.result.status === "outcome_unknown" || assessment.result.receipt.actualMicro === null ? "outcome_unknown" : "unresolved_at_limit",
        `support_${assessment.result.status}`,
        { searchIntentId: search.intentId, modelIntentId: assessment.intentId });
      continue;
    }
    const checks = resolveScopedSupport({ assertions: [assertion], passages: basis.context.passages, proposal: assessment.result.output });
    const outcome = counterevidenceOutcome(checks);
    const next = checks[0]?.decision;
    await finish("challenged", outcome, null, {
      searchIntentId: search.intentId,
      modelIntentId: assessment.intentId,
      changedConclusion: next != null && next !== initial.decision,
    });
  }
  return { kind: "recorded" as const, version: CONCLUSION_CHALLENGE_VERSION, count: conclusions.length };
}
