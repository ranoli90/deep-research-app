import type { CandidateRecord } from "./candidates.js";

export const CANDIDATE_LEDGER_VERSION = "candidate-ledger.v1";

export type CandidateStatus = "discovered" | "inspected" | "eligible" | "excluded" | "unresolved";

export type LedgerEntry = CandidateRecord & {
  status: CandidateStatus;
  exclusionReason: string | null;
};

export type CandidateLedgerCoverage = {
  searches: number;
  remainingDistinctStrategy: boolean;
  reopened?: boolean;
  sourceClassesAttempted?: string[];
};

export type CandidateLedger = {
  version: typeof CANDIDATE_LEDGER_VERSION;
  entries: LedgerEntry[];
  universeComplete: boolean;
  completenessNote: string;
};

function completenessFromCoverage(coverage?: CandidateLedgerCoverage): Pick<CandidateLedger, "universeComplete" | "completenessNote"> {
  const searches = coverage?.searches ?? 0;
  const reopened = coverage?.reopened === true;
  const remaining = coverage?.remainingDistinctStrategy !== false;
  if (reopened) {
    return {
      universeComplete: false,
      completenessNote: "A constraint changed; previously excluded candidates must be rediscovered before a completeness claim.",
    };
  }
  if (searches > 0 && !remaining) {
    return {
      universeComplete: true,
      completenessNote: "No remaining distinct discovery strategy; this is a bounded result over the inspected set, not a claim that no option exists outside it.",
    };
  }
  return {
    universeComplete: false,
    completenessNote: "Do not claim the option set is complete; additional eligible candidates may exist.",
  };
}

export function entryStatusFor(candidate: CandidateRecord, readable: boolean): CandidateStatus {
  if (candidate.feasibility === "violates") return "excluded";
  if (!readable) return "discovered";
  if (candidate.feasibility === "satisfies") return "eligible";
  if (candidate.feasibility === "unknown") return "inspected";
  return "unresolved";
}

export function mergeCandidateRecords(
  existing: LedgerEntry[],
  discovered: CandidateRecord[],
  args: { readablePassageIds: ReadonlySet<string> },
): LedgerEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const c of discovered) {
    const next: LedgerEntry = {
      ...c,
      status: entryStatusFor(c, args.readablePassageIds.has(c.discoveredFrom)),
      exclusionReason: c.excludedBy ?? null,
    };
    const prev = byId.get(c.id);
    if (prev?.status === "excluded" && next.status !== "excluded") {
      byId.set(c.id, { ...prev, discoveredFrom: c.discoveredFrom || prev.discoveredFrom });
      continue;
    }
    byId.set(c.id, next);
  }
  return [...byId.values()];
}

export function buildCandidateLedger(
  candidates: CandidateRecord[] | LedgerEntry[],
  coverage?: CandidateLedgerCoverage,
): CandidateLedger {
  const entries: LedgerEntry[] = candidates.map((c) =>
    "status" in c
      ? c
      : {
          ...c,
          status: c.feasibility === "violates" ? "excluded" : c.feasibility === "satisfies" ? "eligible" : "unresolved",
          exclusionReason: c.excludedBy ?? null,
        },
  );
  return {
    version: CANDIDATE_LEDGER_VERSION,
    entries,
    ...completenessFromCoverage(coverage),
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
