import { CONTROLLER_CONTRACT_VERSION } from "@deep/contracts";
import { constraintProvenance } from "./provenance.js";
import { classifySourceIndependence, independentConfirmationCount } from "./independence.js";
import { deriveResearchQuestions } from "./questions.js";
import type { ControllerState } from "./types.js";

/**
 * Compact typed projection for model proposals. Not a database dump.
 */
export function projectControllerState(state: ControllerState): Record<string, unknown> {
  const questions = state.questions?.length ? state.questions : deriveResearchQuestions(state);
  return {
    controllerVersion: state.controllerVersion ?? CONTROLLER_CONTRACT_VERSION,
    runId: state.runId,
    briefRevision: state.brief.revision,
    evidenceRevision: state.basis.evidenceRevision,
    objective: state.brief.originalQuestion.slice(0, 500),
    desiredOutput: state.brief.desiredOutcome ?? state.brief.outputPreferences,
    phase: state.phase,
    constraints: state.constraints.map((c) => ({
      id: c.id,
      field: c.field,
      operator: c.operator,
      value: c.value,
      units: c.units,
      importance: c.importance,
      provenance: constraintProvenance(c),
      origin: c.origin,
    })),
    assumptions: state.brief.assumptions.map((a) => ({
      id: a.id,
      value: a.value,
      confirmation: a.userConfirmationState,
    })),
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      importance: q.importance,
      blocking: q.blocking,
      answerShape: q.answerShape,
      evidenceRequirement: q.evidenceRequirement,
      completionCondition: q.completionCondition,
      status: q.status,
    })),
    gaps: state.gaps.map((g) => ({
      id: g.id,
      missingFact: g.missingFact,
      importance: g.importance,
      sourceTypeNeeded: g.sourceTypeNeeded,
      latestOutcome: g.latestOutcome,
      remainingUncertainty: g.remainingUncertainty,
      attempts: g.attempts?.length ?? 0,
    })),
    sources: state.sources.map((s) => ({
      id: s.id,
      title: s.title,
      accessLevel: s.accessLevel,
      sourceType: s.sourceType,
      independence: classifySourceIndependence(s),
      originCluster: s.originCluster,
    })),
    independentClusters: independentConfirmationCount(state.sources),
    passageCount: state.passages.length,
    claims: state.claims.slice(0, 12).map((c) => ({
      id: c.id,
      type: c.type,
      supportStatus: c.supportStatus,
      text: c.text.slice(0, 180),
    })),
    contradictions: (state.contradictions ?? []).map((c) => ({
      id: c.id,
      dimension: c.dimension,
      resolutionStatus: c.resolutionStatus,
      possibleExplanation: c.possibleExplanation,
      impact: c.impact,
    })),
    calculations: (state.calculations ?? []).map((c) => ({
      id: c.id,
      formulaName: c.formulaName,
      status: c.status,
      missing: c.missing,
    })),
    verificationTasks: (state.verificationTasks ?? []).map((v) => ({
      id: v.id,
      target: v.target,
      status: v.status,
    })),
    disconfirmations: (state.disconfirmations ?? []).map((d) => ({
      id: d.id,
      result: d.result,
      counterevidenceFound: d.counterevidenceFound,
    })),
    previousActions: (state.actionHistory ?? []).slice(-8).map((a) => ({
      type: a.type,
      selectionReason: a.selectionReason,
      pivotReason: a.pivotReason,
    })),
    budget: { spentMicro: state.spentMicro, budgetMicro: state.budgetMicro },
    freshness: state.brief.freshnessRequirements,
    runState: { phase: state.phase, deleted: state.deleted, cancellationEpoch: state.basis.cancellationEpoch },
    unresolvedUncertainty: state.gaps
      .filter((g) => g.importance !== "background" && g.latestOutcome !== "resolved")
      .map((g) => g.remainingUncertainty ?? g.missingFact),
    stopReason: state.stopReason,
  };
}
