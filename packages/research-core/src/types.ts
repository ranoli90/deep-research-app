import type {
  AccessLevel,
  ActionProposal,
  Constraint,
  ConstraintProvenance,
  Phase,
  ResearchBrief,
  RevisionBasis,
} from "@deep/contracts";

export const CONTROLLER_VERSION = "research-controller.v1";

export type StatementClass = "fact" | "calculation" | "inference" | "uncertainty";

export type ResearchQuestion = {
  id: string;
  text: string;
  importance: "blocking" | "material" | "background";
  blocking: boolean;
  answerShape: "boolean" | "comparison" | "numeric" | "eligibility" | "existence" | "narrative";
  evidenceRequirement: string;
  completionCondition: string;
  dependentClaimIds: string[];
  status: "open" | "answered" | "blocked" | "unresolvable";
};

export type Contradiction = {
  id: string;
  claimA: string;
  claimB: string;
  sourceA: string;
  sourceB: string;
  passageAId: string;
  passageBId: string;
  dates?: string[];
  geography?: string;
  population?: string;
  productVersion?: string;
  units?: string;
  evidenceQuality: string;
  possibleExplanation: string;
  resolutionStatus: "unresolved" | "explained" | "verified";
  resolutionEvidence?: string;
  impact: string;
  dimension: "value" | "date" | "geography" | "population" | "version" | "units" | "scope" | "compatibility";
};

export type CalculationRecord = {
  id: string;
  formulaName: string;
  formulaVersion: string;
  inputs: { name: string; value?: number; units: string; sourceClaimId?: string }[];
  output?: number;
  units?: string;
  expression?: string;
  assumptions: string[];
  rounding?: string;
  status: "computed" | "unknown";
  missing: string[];
  provenance: string;
};

export type DisconfirmationRecord = {
  id: string;
  targetConclusion: string;
  falsificationHypothesis: string;
  searchStrategy: string;
  result: "counterevidence_found" | "no_counterexample_found" | "untried";
  counterevidenceFound: boolean;
  impact: string;
};

export type VerificationTask = {
  id: string;
  claimId?: string;
  target: string;
  reason: string;
  checks: string[];
  status: "pending" | "completed";
  outcome?: string;
};

export type ActionReceipt = {
  type: string;
  rationale: string;
  selectionReason: string;
  pivotReason?: string;
  gapId?: string;
  atEvidenceRevision: number;
};

export type SourceIndependenceClass = "first-party" | "secondary" | "independent" | "community" | "derived";

export type AblationFlags = {
  disableGapDetection?: boolean;
  disableSourcePivot?: boolean;
  disableContradictionHandling?: boolean;
  disableDisconfirmation?: boolean;
  disableEvidenceAwareStop?: boolean;
};

export type ConstraintView = Constraint & { provenance: ConstraintProvenance };

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
  derivation?: import("./report-derivations.js").ReportDerivation;
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
  preferredSourceTypes?: string[];
  suggestedQuery?: string;
  attempts?: GapAttempt[];
  latestOutcome?: string;
  remainingUncertainty?: string;
  questionId?: string;
  description?: string;
  dependencies?: string[];
  resolution?: string;
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
  /** Typed actions already completed (compare/calculate/verify/replan/challenge). */
  completedActionTypes?: string[];
  stopReason?: string;
  controllerVersion?: string;
  questions?: ResearchQuestion[];
  contradictions?: Contradiction[];
  calculations?: CalculationRecord[];
  disconfirmations?: DisconfirmationRecord[];
  verificationTasks?: VerificationTask[];
  actionHistory?: ActionReceipt[];
  lastPivotReason?: string;
  ablations?: AblationFlags;
};

export type PolicyDecision = ActionProposal & { rejectReason?: string };
