import type { AccessLevel, ActionProposal, Constraint, Phase, ResearchBrief, RevisionBasis } from "@deep/contracts";

export type StoredSource = {
  id: string;
  title: string;
  locator: string;
  publisher?: string;
  accessLevel: AccessLevel;
  originCluster?: string;
  sourceFamily?: string;
  sourceType?: string;
  population?: string;
  snippet?: string;
  language?: string;
  translated?: boolean;
};

export type StoredPassage = {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  exactText: string;
  locator: string;
  language?: string;
  translated?: boolean;
};

export type StoredClaim = {
  id: string;
  text: string;
  type: string;
  supportStatus: string;
  passageIds: string[];
};

export type Coverage = {
  id: string;
  question: string;
  status: "unstarted" | "investigating" | "supported" | "qualified" | "blocked" | "excluded-by-user";
  limitation?: string;
};

export type GapAttempt = {
  actionType: string;
  query?: string;
  outcome: string;
  atEvidenceRevision: number;
};

export type Gap = {
  id: string;
  missingFact: string;
  whyItCouldChangeAnswer: string;
  /** Conclusion or candidate status that stays conditional until this gap is resolved. */
  dependentConclusion?: string;
  /** What evidence would resolve it. */
  resolvingEvidence?: string;
  importance: "blocking" | "material" | "background";
  sourceTypeNeeded?: string;
  suggestedQuery?: string;
  attempts?: GapAttempt[];
  latestOutcome?: string;
  remainingUncertainty?: string;
};

export type SearchTrace = {
  query: string;
  sourceFamilyIds: string[];
  newFamilies: number;
  coverageProgress: boolean;
};

export type ControllerState = {
  runId: string;
  brief: ResearchBrief;
  basis: RevisionBasis;
  phase: Phase;
  sources: StoredSource[];
  passages: StoredPassage[];
  claims: StoredClaim[];
  coverage: Coverage[];
  gaps: Gap[];
  searches: SearchTrace[];
  constraints: Constraint[];
  candidates: { id: string; identity: string; excludedBy?: string; feasibility?: string }[];
  spentMicro: number;
  budgetMicro: number;
  deleted: boolean;
  privateCanaries: string[];
  reopenedDiscovery?: boolean;
  dependencyCompleteness?: "known" | "partial" | "unknown";
  /** Dedupe keys already issued or rejected for this run. */
  issuedDedupeKeys?: string[];
  /** Typed actions already completed (compare/calculate/verify/replan). */
  completedActionTypes?: string[];
  stopReason?: string;
};

export type PolicyDecision = ActionProposal & { rejectReason?: string };
