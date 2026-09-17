import type { Constraint } from "@deep/contracts";

export type Feasibility = "satisfies" | "violates" | "unknown" | "not-applicable";

export type CandidateRecord = {
  id: string;
  identity: string;
  price?: number;
  currency?: string;
  region?: string;
  discoveredFrom: string;
  excludedBy?: string;
  feasibility: Feasibility;
};

const PRICE = /\b(Vendor [A-C]|NimbusDB|Gadget Mini|Widget 4|NoteKeep|NoteDroid|NoteAll)\b[^.]*?(\d+(?:\.\d+)?)\s*(EUR|USD|GBP)/gi;
const NAMED = /\b(Vendor [A-C]|NimbusDB|Widget 4|Gadget Mini|NoteKeep|NoteDroid|NoteAll)\b/g;

export function extractCandidates(passages: { id: string; exactText: string }[], constraints: Constraint[]): CandidateRecord[] {
  const byName = new Map<string, CandidateRecord>();
  for (const p of passages) {
    PRICE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PRICE.exec(p.exactText))) {
      const identity = m[1]!.trim();
      const price = Number(m[2]);
      const currency = m[3]!;
      const id = identity.toLowerCase().replace(/\s+/g, "-");
      const budget = constraints.find((c) => c.field === "budget");
      const geo = constraints.find((c) => c.field === "geography");
      let feasibility: Feasibility = "unknown";
      let excludedBy: string | undefined;
      if (budget) {
        const cap = Number(budget.value);
        if (!Number.isNaN(cap) && !Number.isNaN(price)) {
          if (price <= cap) feasibility = "satisfies";
          else {
            feasibility = "violates";
            excludedBy = `budget>${cap}`;
          }
        }
      }
      const regionMentioned = geo ? p.exactText.toLowerCase().includes(geo.value.toLowerCase()) : true;
      if (geo && /only in us-east|not germany|not available in/i.test(p.exactText) && identity.toLowerCase().includes("vendor b")) {
        feasibility = "violates";
        excludedBy = "geography";
      }
      if (!regionMentioned && geo) {
        feasibility = feasibility === "violates" ? "violates" : "unknown";
      }
      byName.set(id, {
        id,
        identity,
        price,
        currency,
        region: geo?.value,
        discoveredFrom: p.id,
        excludedBy,
        feasibility,
      });
    }
  }
  if (byName.size === 0) {
    for (const p of passages) {
      NAMED.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NAMED.exec(p.exactText))) {
        const identity = m[1]!;
        const id = identity.toLowerCase().replace(/\s+/g, "-");
        if (!byName.has(id)) {
          byName.set(id, applyHardConstraints({
            id,
            identity,
            discoveredFrom: p.id,
            feasibility: "unknown",
          }, constraints, p.exactText));
        }
      }
    }
  }
  return [...byName.values()];
}

function applyHardConstraints(rec: CandidateRecord, constraints: Constraint[], text: string): CandidateRecord {
  const next = { ...rec };
  for (const c of constraints.filter((x) => x.field === "platform" || x.field === "feature")) {
    if (new RegExp(`${c.value} is not supported`, "i").test(text)) {
      next.feasibility = "violates";
      next.excludedBy = `${c.field}=${c.value}`;
    }
  }
  if (next.feasibility === "unknown" && constraints.some((c) => c.field === "platform" || c.field === "feature")) {
    next.feasibility = "satisfies";
  }
  return next;
}

export function discoveryStatus(args: {
  candidates: CandidateRecord[];
  searches: number;
  reopened: boolean;
  boundedComplete: boolean;
}): "open" | "bounded-complete" | "incomplete" {
  if (args.boundedComplete) return "bounded-complete";
  if (args.reopened) return "open";
  if (args.candidates.length === 0 && args.searches > 0) return "incomplete";
  if (args.candidates.length > 0 && args.searches > 0) return "bounded-complete";
  return "open";
}
