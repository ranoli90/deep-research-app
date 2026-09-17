import {
  CONSENT_POLICY_VERSION,
  DEFAULT_RUN_BUDGET_MICRO,
  FIXTURE_FETCH_COST_MICRO,
  FIXTURE_SEARCH_COST_MICRO,
  FIXTURE_SYNTH_COST_MICRO,
} from "@deep/contracts";
import {
  applyCorrectionToConstraints,
  composeReport,
  detectGaps,
  extractCandidates,
  extractConstraints,
  proposeControllerAction,
  type ControllerKind,
  type ControllerState,
  type StoredPassage,
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
};

export type TaskSpec = {
  id: string;
  family: string;
  question: string;
  goldLocators: string[];
};

export const FIXTURE_BENCHMARK_TASKS: TaskSpec[] = [
  {
    id: "hard-constraint-postgres",
    family: "hard-constraint-comparisons",
    question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
    goldLocators: ["fixture://vendor-a/pricing-de", "fixture://vendor-b/pricing-de"],
  },
  {
    id: "conflicting-nimbus",
    family: "conflicting-claims",
    question: "Is NimbusDB compatible with Postgres 14?",
    goldLocators: ["fixture://vendor/nimbus-matrix"],
  },
  {
    id: "niche-deepseek",
    family: "niche-research",
    question: "Does DeepSeek-Research-Pro include a built-in vector database?",
    goldLocators: ["fixture://catalog/deepseek-research-pro"],
  },
  {
    id: "contradict-price",
    family: "document-web-synthesis",
    question: "What does Gadget Mini cost on 2026-03-01?",
    goldLocators: ["fixture://price/a", "fixture://price/b"],
  },
  {
    id: "purchase-50",
    family: "purchase-decisions",
    question: "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01",
    goldLocators: ["fixture://vendor-a/pricing-de"],
  },
  {
    id: "notes-tradeoff",
    family: "technical-tradeoffs",
    question: "Compare note-taking apps with offline editing, Android and iPhone support, and full export required.",
    goldLocators: [],
  },
  {
    id: "correction-120",
    family: "changed-assumption-corrections",
    question:
      "Compare managed Postgres options in Germany under 50 EUR as of 2026-03-01\n\nCorrection: Actually, the budget is 120 EUR",
    goldLocators: ["fixture://vendor-c/pricing-de"],
  },
];

function initialState(question: string): ControllerState {
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
  };
  state.gaps = detectGaps(state);
  return state;
}

export function runFixtureArm(kind: ControllerKind, task: TaskSpec): ArmResult {
  const state = initialState(task.question);
  const actions: string[] = [];
  const stopReasons: string[] = [];
  let pivots = 0;
  const fetched = new Set<string>();

  for (let step = 0; step < 12; step++) {
    const decision = proposeControllerAction(state, kind);
    actions.push(decision.type);
    state.issuedDedupeKeys = [...(state.issuedDedupeKeys ?? []), decision.dedupeKey];

    if (decision.arguments?.pivot) pivots += 1;
    if (decision.arguments?.reason) stopReasons.push(String(decision.arguments.reason));
    if (decision.rejectReason) stopReasons.push(decision.rejectReason);

    if (decision.type === "search") {
      const query = String(decision.arguments.query ?? task.question);
      const hits = fixtureSearch(query);
      const families = hits.map((h) => h.originCluster);
      const seen = new Set(state.searches.flatMap((s) => s.sourceFamilyIds));
      let newFamilies = 0;
      for (const f of families) {
        if (!seen.has(f)) newFamilies += 1;
      }
      state.searches.push({
        query,
        sourceFamilyIds: families,
        newFamilies,
        coverageProgress: newFamilies > 0,
      });
      for (const hit of hits) {
        if (state.sources.some((s) => s.locator === hit.locator)) continue;
        state.sources.push({
          id: hit.locator,
          title: hit.title,
          locator: hit.locator,
          accessLevel: hit.snippet ? "snippet" : "discovered",
          originCluster: hit.originCluster,
          sourceType: hit.sourceType,
          population: hit.population,
        });
      }
      state.spentMicro += FIXTURE_SEARCH_COST_MICRO;
      state.basis.evidenceRevision += 1;
      state.coverage = state.coverage.map((c) => (c.status === "unstarted" ? { ...c, status: "investigating" } : c));
      state.gaps = detectGaps(state);
      continue;
    }

    if (decision.type === "fetch") {
      const locator = String(decision.arguments.locator ?? "");
      const doc = fixtureFetch(locator);
      fetched.add(locator);
      const src = state.sources.find((s) => s.locator === locator || s.id === decision.arguments.sourceId);
      if (src) src.accessLevel = doc.accessLevel;
      const passage: StoredPassage = {
        id: `p-${state.passages.length + 1}`,
        sourceId: src?.id ?? locator,
        sourceVersionId: `v-${state.passages.length + 1}`,
        exactText: doc.text,
        locator: "document",
      };
      state.passages.push(passage);
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
      state.gaps = detectGaps(state);
      continue;
    }

    if (decision.type === "compare" || decision.type === "calculate" || decision.type === "verify" || decision.type === "replan") {
      state.completedActionTypes = [...(state.completedActionTypes ?? []), decision.type];
      continue;
    }

    state.spentMicro += FIXTURE_SYNTH_COST_MICRO;
    break;
  }

  const report = composeReport(state, "00000000-0000-4000-8000-000000000099");
  const citationIds = report.blocks.flatMap((b) => b.citationIds);
  const known = new Set(state.passages.map((p) => p.id));
  const unknownCitations = citationIds.filter((id) => !known.has(id)).length;
  const goldLocatorsFetched = task.goldLocators.filter((l) => fetched.has(l) || state.sources.some((s) => s.locator === l && (s.accessLevel === "full-text" || s.accessLevel === "partial-text")));
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
  };
}

export type BenchmarkRow = {
  taskId: string;
  family: string;
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


