import type { CandidateRecord } from "./candidates.js";

export const CANDIDATE_LEDGER_VERSION = "candidate-ledger.v1";

export type CandidateStatus = "discovered" | "inspected" | "eligible" | "excluded" | "unresolved";

export type LedgerEntry = CandidateRecord & {
  status: CandidateStatus;
  exclusionReason: string | null;
};

export type CandidateLedger = {
  version: typeof CANDIDATE_LEDGER_VERSION;
  entries: LedgerEntry[];
  universeComplete: boolean;
  completenessNote: string;
};

export function buildCandidateLedger(candidates: CandidateRecord[], args?: { boundedComplete?: boolean }): CandidateLedger {
  const entries: LedgerEntry[] = candidates.map((c) => ({
    ...c,
    status: c.feasibility === "violates" ? "excluded" : c.feasibility === "satisfies" ? "eligible" : "unresolved",
    exclusionReason: c.excludedBy ?? null,
  }));
  const complete = args?.boundedComplete === true;
  return {
    version: CANDIDATE_LEDGER_VERSION,
    entries,
    universeComplete: complete,
    completenessNote: complete
      ? "Search universe was treated as bounded-complete for this run."
      : "Do not claim the option set is complete; additional eligible candidates may exist.",
  };
}

/** A constraint change (budget/geography) reopens exclusions for rediscovery. */
export function reopenExclusions(ledger: CandidateLedger, changedFields: string[]): CandidateLedger {
  if (!changedFields.length) return ledger;
  return {
    ...ledger,
    universeComplete: false,
    completenessNote: "A constraint changed; previously excluded candidates must be rediscovered before a completeness claim.",
    entries: ledger.entries.map((e) =>
      e.status === "excluded"
        ? { ...e, status: "discovered" as const, feasibility: "unknown" as const, excludedBy: undefined, exclusionReason: null }
        : e,
    ),
  };
}
