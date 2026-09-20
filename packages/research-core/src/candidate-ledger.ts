import type { CandidateRecord } from "./candidates.js";
import { MAX_DISCOVERY_QUERIES } from "./discovery-planning.js";

export const CANDIDATE_LEDGER_VERSION = "candidate-ledger.v1";

export type CandidateStatus = "discovered" | "inspected" | "eligible" | "excluded" | "unresolved";

export type LedgerEntry = CandidateRecord & {
  status: CandidateStatus;
  exclusionReason: string | null;
};

export type CandidateStopProof = {
  reason: string;
  stopPolicy: string;
};

/** Durable search coverage + stop proof. Caller booleans cannot stamp completeness. */
export type CandidateLedgerCoverage = {
  queriesAttempted: string[];
  sourceClassesAttempted: string[];
  stop?: CandidateStopProof | null;
  reopened?: boolean;
};

export type CandidateLedger = {
  version: typeof CANDIDATE_LEDGER_VERSION;
  entries: LedgerEntry[];
  universeComplete: boolean;
  completenessNote: string;
};

const EXHAUSTION_STOPS = new Set([
  "hard_discovery_ceiling",
  "discovery_query_limit",
  "no_distinct_source_strategy",
  "no_distinct_public_criterion_query",
]);

const INCOMPLETE_NOTE = "Do not claim the option set is complete; additional eligible candidates may exist.";

function completenessFromCoverage(coverage?: CandidateLedgerCoverage): Pick<CandidateLedger, "universeComplete" | "completenessNote"> {
  const queries = coverage?.queriesAttempted ?? [];
  const stop = coverage?.stop ?? null;
  if (coverage?.reopened === true) {
    return {
      universeComplete: false,
      completenessNote: "A constraint changed; previously excluded candidates must be rediscovered before a completeness claim.",
    };
  }
  if (!stop || stop.stopPolicy === "continue" || !EXHAUSTION_STOPS.has(stop.reason) || queries.length < 2) {
    return { universeComplete: false, completenessNote: INCOMPLETE_NOTE };
  }
  if ((stop.reason === "hard_discovery_ceiling" || stop.reason === "discovery_query_limit") && queries.length < MAX_DISCOVERY_QUERIES) {
    return { universeComplete: false, completenessNote: INCOMPLETE_NOTE };
  }
  return {
    // Exhausting a bounded search budget never proves the external universe complete.
    universeComplete: false,
    completenessNote: "Durable search coverage reached a discovery stop; this is a bounded result over the inspected set, not a claim that no option exists outside it.",
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

/** A bounded discovery stop never licenses a universal ranking in final prose. */
export function candidateClaimsBounded(texts: readonly string[]): boolean {
  return texts.every(text => {
    const ranks=/\b(best|winner|unmatched|unbeatable|exhaustive|only (?:option|choice)|all (?:available )?(?:options|candidates))\b/iu.test(text);
    return !ranks || /\b(?:among|of|within) (?:the )?(?:inspected|reviewed|tested|compared) (?:options|candidates|products|sources)\b/iu.test(text);
  });
}
export const CANDIDATE_SCOPE_LIMITATION="This comparison covers inspected candidates only; additional eligible options may exist.";
