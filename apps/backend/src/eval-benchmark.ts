import {
  CONSENT_POLICY_VERSION,
  DEFAULT_RUN_BUDGET_MICRO,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import {
  applyCorrectionToConstraints,
  applyFetchedDocument,
  applySearchHits,
  composeReport,
  detectContradictions,
  detectGaps,
  evaluateDisconfirmation,
  extractCandidates,
  extractConstraints,
  planDisconfirmation,
  proposeControllerAction,
  recordCompletedAction,
  type AblationFlags,
  type ControllerKind,
  type ControllerState,
} from "@deep/research-core";
import { fixtureFetch, fixtureSearch } from "./adapters/retrieval/fixture.js";

export type ArmResult = {
  kind: ControllerKind;
  question: string;
  steps: number;
  actions: string[];
  pivots: number;
  stopReasons: string[];
  spentMicro: number;
  citationIds: string[];
  unknownCitations: number;
  goldLocatorsFetched: string[];
  goldLocatorsMissed: string[];
  hardConstraintViolations: number;
  candidateIdentities: string[];
  reportText: string;
  selectionReasons?: string[];
  contradictions?: number;
  disconfirmations?: number;
  trace?: Record<string, unknown>;
};

export type GoldPacket = {
  expectedConstraints: string[];
  decisiveClaims: string[];
  goldEvidence: string[];
  acceptableAlternateEvidence: string[];
  knownTraps: string[];
  freshnessWindow: string;
  acceptableUncertainty: string;
};

export type TaskSpec = {
  id: string;
  family: string;
  question: string;
  goldLocators: string[];
  gold?: GoldPacket;
};

export const FIXTURE_BENCHMARK_TASKS: TaskSpec[] = [
  {
    id: "hard-constraint-postgres",
    family: "hard-constraint-comparisons",
    question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
    goldLocators: ["fixture://vendor-a/pricing-de", "fixture://vendor-b/pricing-de"],
    gold: {
      expectedConstraints: ["geography=germany", "budget=50", "date=2026-03-01"],
      decisiveClaims: ["Vendor A 40 EUR Germany", "Vendor B 90 EUR Germany exceeds 50"],
      goldEvidence: ["fixture://vendor-a/pricing-de", "fixture://vendor-b/pricing-de"],
      acceptableAlternateEvidence: [],
      knownTraps: ["us-east 35 EUR SKU is not Germany"],
      freshnessWindow: "as of 2026-03-01",
      acceptableUncertainty: "bounded inspected set, not an exhaustive market",
    },
  },
  {
    id: "conflicting-nimbus",
    family: "conflicting-claims",
    question: "Is NimbusDB compatible with Postgres 14?",
    goldLocators: ["fixture://vendor/nimbus-matrix"],
    gold: {
      expectedConstraints: [],
      decisiveClaims: ["not compatible with Postgres 14"],
      goldEvidence: ["fixture://vendor/nimbus-matrix"],
      acceptableAlternateEvidence: [],
      knownTraps: ["review summaries claiming universal compatibility"],
      freshnessWindow: "version-specific matrix, not recency",
      acceptableUncertainty: "summaries remain on the record as secondary",
    },
  },
  {
    id: "niche-deepseek",
    family: "niche-research",
    question: "Does DeepSeek-Research-Pro include a built-in vector database?",
    goldLocators: ["fixture://catalog/deepseek-research-pro"],
    gold: {
      expectedConstraints: [],
      decisiveClaims: ["not a real product"],
      goldEvidence: ["fixture://catalog/deepseek-research-pro"],
      acceptableAlternateEvidence: [],
      knownTraps: ["inventing a vector database feature"],
      freshnessWindow: "catalog snapshot",
      acceptableUncertainty: "absence is not a probability of existence",
    },
  },
  {
    id: "contradict-price",
    family: "document-web-synthesis",
    question: "What does Gadget Mini cost on 2026-03-01?",
    goldLocators: ["fixture://price/a", "fixture://price/b"],
    gold: {
      expectedConstraints: ["date=2026-03-01"],
      decisiveClaims: ["19 EUR vs 45 EUR unresolved"],
      goldEvidence: ["fixture://price/a", "fixture://price/b"],
      acceptableAlternateEvidence: [],
      knownTraps: ["averaging the two prices"],
      freshnessWindow: "2026-03-01",
      acceptableUncertainty: "unresolved shop disagreement",
    },
  },
  {
    id: "purchase-50",
    family: "purchase-decisions",
    question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
    goldLocators: ["fixture://vendor-a/pricing-de"],
    gold: {
      expectedConstraints: ["budget=50", "geography=germany"],
      decisiveClaims: ["Vendor A eligible"],
      goldEvidence: ["fixture://vendor-a/pricing-de"],
      acceptableAlternateEvidence: ["fixture://vendor-b/pricing-de"],
      knownTraps: ["including Vendor C at 70 EUR"],
      freshnessWindow: "2026-03-01",
      acceptableUncertainty: "bounded listing",
    },
  },
  {
    id: "notes-tradeoff",
    family: "technical-tradeoffs",
    question: "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.",
    goldLocators: ["fixture://notes/notekeep", "fixture://notes/notedroid", "fixture://notes/noteall"],
    gold: {
      expectedConstraints: ["platform=iphone", "platform=android", "feature=offline", "feature=export"],
      decisiveClaims: ["NoteDroid ineligible without iPhone", "NoteKeep eligible"],
      goldEvidence: ["fixture://notes/notekeep", "fixture://notes/notedroid"],
      acceptableAlternateEvidence: ["fixture://notes/noteall"],
      knownTraps: ["treating Linux as required when not stated"],
      freshnessWindow: "as of 2026-03-01",
      acceptableUncertainty: "inspected vendor matrices only",
    },
  },
  {
    id: "correction-120",
    family: "changed-assumption-corrections",
    question:
      "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01\n\nCorrection: Actually, the budget is 120 EUR",
    goldLocators: ["fixture://vendor-c/pricing-de"],
    gold: {
      expectedConstraints: ["budget=120", "geography=germany"],
      decisiveClaims: ["Vendor C newly eligible"],
      goldEvidence: ["fixture://vendor-c/pricing-de"],
      acceptableAlternateEvidence: ["fixture://vendor-a/pricing-de"],
      knownTraps: ["keeping the 50 EUR exclusion"],
      freshnessWindow: "2026-03-01",
      acceptableUncertainty: "reopened discovery is bounded",
    },
  },
  {
    id: "primary-nimbus",
    family: "primary-source-requirement",
    question: "Is NimbusDB compatible with Postgres 14 according to official documentation?",
    goldLocators: ["fixture://vendor/nimbus-matrix"],
    gold: {
      expectedConstraints: [],
      decisiveClaims: ["not compatible with Postgres 14"],
      goldEvidence: ["fixture://vendor/nimbus-matrix"],
      acceptableAlternateEvidence: [],
      knownTraps: ["certifying from blog roundups"],
      freshnessWindow: "matrix version, not page date",
      acceptableUncertainty: "unopened summaries",
    },
  },
  {
    id: "freshness-price",
    family: "freshness-sensitive",
    question: "What is the current price of Vendor A and when was it founded in 2011?",
    goldLocators: ["fixture://price/historical-list", "fixture://company/founding"],
    gold: {
      expectedConstraints: ["freshness=current"],
      decisiveClaims: ["40 EUR as of 2024 is not current", "founded 2011 is historical"],
      goldEvidence: ["fixture://price/historical-list", "fixture://company/founding"],
      acceptableAlternateEvidence: [],
      knownTraps: ["presenting 2024 list as live price"],
      freshnessWindow: "current vs 2024-01-01",
      acceptableUncertainty: "current live quote not retrieved",
    },
  },
  {
    id: "negative-unobtainium",
    family: "negative-evidence",
    question: "What is the melting point of Unobtainium-99?",
    goldLocators: ["fixture://unknown/unobtainium"],
    gold: {
      expectedConstraints: [],
      decisiveClaims: ["no reliable measurement found"],
      goldEvidence: ["fixture://unknown/unobtainium"],
      acceptableAlternateEvidence: [],
      knownTraps: ["inventing a melting point"],
      freshnessWindow: "registry snapshot",
      acceptableUncertainty: "absence is not a claim that it cannot melt",
    },
  },
  {
    id: "numeric-conflict",
    family: "contradictory-numerical",
    question: "What does Gadget Mini cost on 2026-03-01 in the two shop lists?",
    goldLocators: ["fixture://price/a", "fixture://price/b"],
    gold: {
      expectedConstraints: ["date=2026-03-01"],
      decisiveClaims: ["19 EUR vs 45 EUR"],
      goldEvidence: ["fixture://price/a", "fixture://price/b"],
      acceptableAlternateEvidence: [],
      knownTraps: ["picking the newer scrape automatically"],
      freshnessWindow: "same date both shops",
      acceptableUncertainty: "unresolved numerical conflict",
    },
  },
  {
    id: "multi-jurisdiction-tax",
    family: "multi-jurisdiction",
    question: "What is the filing deadline for employment tax in France?",
    goldLocators: ["fixture://tax/fr-employment-deadline"],
    gold: {
      expectedConstraints: ["geography=france"],
      decisiveClaims: ["France deadline 2 May"],
      goldEvidence: ["fixture://tax/fr-employment-deadline"],
      acceptableAlternateEvidence: [],
      knownTraps: ["Germany July deadline"],
      freshnessWindow: "as of 2026-03-01",
      acceptableUncertainty: "confirmed France only",
    },
  },
];

function initialState(question: string, ablations?: AblationFlags): ControllerState {
  const [baseQ, correction] = question.split(/\n\nCorrection:\s*/);
  const extracted = extractConstraints(baseQ ?? question);
  const constraints = correction ? applyCorrectionToConstraints(extracted, correction).next : extracted;
  const brief = {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    originalQuestion: question,
    language: "en",
    attachmentIds: [] as string[],
    sourceRestrictions: [] as string[],
    nonGoals: [] as string[],
    constraints,
    assumptions: [],
    budgetPolicyId: "default",
    consentPolicyVersion: CONSENT_POLICY_VERSION,
    revision: 1,
  };
  const state: ControllerState = {
    runId: "00000000-0000-4000-8000-000000000003",
    brief,
    basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 0, workerLeaseFence: 1 },
    phase: "researching",
    sources: [],
    passages: [],
    claims: [],
    coverage: [{ id: "primary", question, status: "unstarted" }],
    gaps: [],
    searches: [],
    constraints,
    candidates: [],
    spentMicro: 0,
    budgetMicro: DEFAULT_RUN_BUDGET_MICRO,
    deleted: false,
    privateCanaries: [],
    issuedDedupeKeys: [],
    completedActionTypes: [],
    ablations,
    controllerVersion: "research-controller.v1",
  };
  state.gaps = detectGaps(state);
  return state;
}

export function runFixtureArm(kind: ControllerKind, task: TaskSpec, ablations?: AblationFlags): ArmResult {
  const state = initialState(task.question, ablations);
  const actions: string[] = [];
  const stopReasons: string[] = [];
  const selectionReasons: string[] = [];
  let pivots = 0;
  const fetched = new Set<string>();
  const traceActions: Record<string, unknown>[] = [];

  for (let step = 0; step < 16; step++) {
    const decision = proposeControllerAction(state, kind);
    actions.push(decision.type);
    selectionReasons.push(String(decision.arguments.selectionReason ?? decision.rationale));
    state.issuedDedupeKeys = [...(state.issuedDedupeKeys ?? []), decision.dedupeKey];
    traceActions.push({
      step,
      type: decision.type,
      rationale: decision.rationale,
      selectionReason: decision.arguments.selectionReason,
      pivot: decision.arguments.pivot,
      sourceTypeNeeded: decision.arguments.sourceTypeNeeded,
      gapId: decision.gapId,
      stopPolicy: decision.arguments.stopPolicy,
    });

    if (decision.arguments?.pivot) pivots += 1;
    if (decision.arguments?.reason) stopReasons.push(String(decision.arguments.reason));
    if (decision.rejectReason) stopReasons.push(decision.rejectReason);

    if (decision.type === "search" || (decision.type === "challenge" && decision.arguments.query && !decision.arguments.recordOnly)) {
      const query = String(decision.arguments.query ?? task.question);
      const hits = fixtureSearch(query);
      applySearchHits(
        state,
        query,
        hits.map((h) => ({
          locator: h.locator,
          title: h.title,
          originCluster: h.originCluster,
          sourceType: h.sourceType,
          population: h.population,
          snippet: h.snippet,
        })),
      );
      state.spentMicro += FIXTURE_SEARCH_COST_MICRO;
      state.basis.evidenceRevision += 1;
      state.coverage = state.coverage.map((c) => (c.status === "unstarted" ? { ...c, status: "investigating" } : c));
      continue;
    }

    if (decision.type === "fetch") {
      const locator = String(decision.arguments.locator ?? "");
      const doc = fixtureFetch(locator);
      fetched.add(locator);
      applyFetchedDocument(state, {
        locator,
        text: doc.text,
        accessLevel: doc.accessLevel,
        sourceType: doc.sourceType,
        title: doc.title,
      });
      state.spentMicro += FIXTURE_FETCH_COST_MICRO;
      state.basis.evidenceRevision += 1;
      state.candidates = extractCandidates(state.passages, state.constraints).map((c) => ({
        id: c.id,
        identity: c.identity,
        excludedBy: c.excludedBy,
        feasibility: c.feasibility,
      }));
      if (state.passages.length) {
        state.coverage = state.coverage.map((c) => ({ ...c, status: "supported" }));
      }
      continue;
    }

    if (decision.type === "compare" || decision.type === "calculate" || decision.type === "verify" || decision.type === "replan" || decision.type === "challenge") {
      recordCompletedAction(state, decision.type);
      if (decision.type === "challenge") {
        const planned = planDisconfirmation(state);
        if (planned) state.disconfirmations = [evaluateDisconfirmation(state, planned)];
      }
      if (decision.type === "verify") {
        state.contradictions = detectContradictions(state);
      }
      continue;
    }

    state.spentMicro += FIXTURE_SYNTH_COST_MICRO;
    state.stopReason = String(decision.arguments.reason ?? decision.rationale);
    break;
  }

  const report = composeReport(state, "00000000-0000-4000-8000-000000000099");
  const citationIds = report.blocks.flatMap((b) => b.citationIds);
  const known = new Set(state.passages.map((p) => p.id));
  const unknownCitations = citationIds.filter((id) => !known.has(id)).length;
  const goldLocatorsFetched = task.goldLocators.filter(
    (l) => fetched.has(l) || state.sources.some((s) => s.locator === l && (s.accessLevel === "full-text" || s.accessLevel === "partial-text")),
  );
  const goldLocatorsMissed = task.goldLocators.filter((l) => !goldLocatorsFetched.includes(l));
  const hardConstraintViolations = state.candidates.filter((c) => c.feasibility === "satisfies" && c.excludedBy).length;

  return {
    kind,
    question: task.question,
    steps: actions.length,
    actions,
    pivots,
    stopReasons,
    spentMicro: state.spentMicro,
    citationIds,
    unknownCitations,
    goldLocatorsFetched,
    goldLocatorsMissed,
    hardConstraintViolations,
    candidateIdentities: state.candidates.map((c) => c.identity),
    reportText: report.blocks.map((b) => b.text).join("\n"),
    selectionReasons,
    contradictions: (state.contradictions ?? detectContradictions(state)).length,
    disconfirmations: (state.disconfirmations ?? []).length,
    trace: {
      task: task.question,
      family: task.family,
      controllerVersion: "research-controller.v1",
      kind,
      questions: state.questions,
      gaps: state.gaps,
      actions: traceActions,
      sources: state.sources.map((s) => ({ locator: s.locator, sourceType: s.sourceType, accessLevel: s.accessLevel })),
      contradictions: state.contradictions ?? detectContradictions(state),
      disconfirmations: state.disconfirmations,
      stopReason: state.stopReason,
      cost: state.spentMicro,
    },
  };
}

export type BenchmarkRow = {
  taskId: string;
  family: string;
  gold?: GoldPacket;
  baseline: ArmResult;
  adaptive: ArmResult;
};

export function runFixtureBenchmark(): {
  protocol: string;
  evidenceClass: "fixture";
  provider: "app-owned-fixture-catalog";
  model: "none — deterministic controller";
  budgetPolicy: "DEFAULT_RUN_BUDGET_MICRO with fixture tariffs";
  competitorComparison: "not_run";
  rows: BenchmarkRow[];
} {
  const rows = FIXTURE_BENCHMARK_TASKS.map((task) => ({
    taskId: task.id,
    family: task.family,
    gold: task.gold,
    baseline: runFixtureArm("baseline", task),
    adaptive: runFixtureArm("adaptive", task),
  }));
  return {
    protocol: "EVALUATION.md fixture-first baseline vs adaptive; same catalog, tariffs, and questions",
    evidenceClass: "fixture",
    provider: "app-owned-fixture-catalog",
    model: "none — deterministic controller",
    budgetPolicy: "DEFAULT_RUN_BUDGET_MICRO with fixture tariffs",
    competitorComparison: "not_run",
    rows,
  };
}

export function runAblations(taskId = "conflicting-nimbus"): Record<string, ArmResult> {
  const task = FIXTURE_BENCHMARK_TASKS.find((t) => t.id === taskId) ?? FIXTURE_BENCHMARK_TASKS[1]!;
  return {
    full: runFixtureArm("adaptive", task),
    noGapDetection: runFixtureArm("adaptive", task, { disableGapDetection: true }),
    noSourcePivot: runFixtureArm("adaptive", task, { disableSourcePivot: true }),
    noContradictionHandling: runFixtureArm("adaptive", task, { disableContradictionHandling: true }),
    noDisconfirmation: runFixtureArm("adaptive", task, { disableDisconfirmation: true }),
    noEvidenceAwareStop: runFixtureArm("adaptive", task, { disableEvidenceAwareStop: true }),
  };
}
