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

// A bounded literal extractor, not a product catalogue or a semantic model.
// Unknown grammar and missing criteria remain unknown and can be proposed to the model gateway later.
const SUBJECT = /^([\p{Lu}][\p{L}\p{N}&+./-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}&+./-]*){0,5})(?=[:’']|\s+[\p{Ll}])/u;
const PRONOUNS = new Set(["A", "An", "The", "This", "That", "It", "As", "No"]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractCandidates(passages: { id: string; exactText: string }[], constraints: Constraint[]): CandidateRecord[] {
  const records = new Map<string, CandidateRecord>();
  for (const passage of passages) {
    const sentences = passage.exactText.split(/(?<=[.!?])\s+(?=\p{Lu})|\n+/u).map((s) => s.trim());
    const named = sentences.flatMap((text) => {
      const identity = text.match(SUBJECT)?.[1];
      if (!identity || PRONOUNS.has(identity) || !/(?:\d+(?:[.,]\d+)?\s*(?:EUR|USD|GBP)\b|\bsupports\b|\bexports\b|\bare supported\b|\bcompatible\b|\bdoes not exist\b)/i.test(text)) return [];
      return [{ identity, text }];
    });
    for (const { identity, text } of named) {
      const id = identity.toLowerCase().replace(/\s+/g, "-");
      const priceMatch = text.match(/\b(\d+(?:\.\d+|,\d{2})?)\s*(EUR|USD|GBP)\b/i);
      const price = priceMatch ? Number(priceMatch[1]!.replace(",", ".")) : undefined;
      const currency = priceMatch?.[2]?.toUpperCase();
      const context = new Set(named.map((n) => n.identity)).size === 1 ? passage.exactText : text;
      const hard = constraints.filter((c) => c.importance === "hard");
      const checks = hard.map((criterion): "supports" | "violates" | "unknown" => {
        if (criterion.field === "budget") {
          const cap = Number(criterion.value);
          if (price === undefined || !Number.isFinite(cap) || currency !== criterion.units?.toUpperCase() || criterion.operator !== "lte") return "unknown";
          return price <= cap ? "supports" : "violates";
        }
        const value = escape(criterion.value);
        if (criterion.field === "geography") {
          // Price variants are scoped to their sentence: a different region/SKU cannot qualify this price.
          if (new RegExp(`\\bnot (?:available (?:in )?)?${value}\\b`, "i").test(text)) return "violates";
          return new RegExp(`\\b(?:in|for|region[: ]+)\\s*${value}\\b`, "i").test(text) ? "supports" : "unknown";
        }
        if (criterion.field === "date") {
          return new RegExp(`\\bas of\\s+${value}\\b`, "i").test(context) ? "supports" : "unknown";
        }
        if (criterion.field === "platform" || criterion.field === "feature") {
          if (new RegExp(`\\b${value}\\b[^.!?]*?\\b(?:is not supported|not supported|unavailable)\\b|\\b(?:does not support|cannot export)\\s+${value}\\b`, "i").test(context)) return "violates";
          const positive = new RegExp(`\\b(?:supports|exports)\\b[^.!?]*\\b${value}\\b|\\b${value}\\b[^.!?]*\\bare supported\\b`, "i").test(context);
          const conditional = /\b(?:may|might|could|planned|if|except|unless|partial|limited)\b/i.test(context);
          return positive && !conditional ? "supports" : "unknown";
        }
        return "unknown";
      });
      const violation = checks.indexOf("violates");
      const geo = hard.find((c) => c.field === "geography");
      const candidate: CandidateRecord = { id, identity, price, currency, discoveredFrom: passage.id,
        region: geo && new RegExp(`\\b(?:in|for)\\s+${escape(geo.value)}\\b`, "i").test(text) ? geo.value : undefined,
        feasibility: violation >= 0 ? "violates" : checks.length && checks.every((c) => c === "supports") ? "satisfies" : "unknown",
        excludedBy: violation < 0 ? undefined : hard[violation]!.field === "budget" ? `budget>${hard[violation]!.value}` : `${hard[violation]!.field}=${hard[violation]!.value}` };
      const old = records.get(id);
      if (old && (old.price !== candidate.price || old.currency !== candidate.currency || old.region !== candidate.region || old.feasibility !== candidate.feasibility)) {
        records.set(id, { ...old, price: undefined, region: undefined, feasibility: "unknown", excludedBy: undefined });
      } else records.set(id, candidate);
    }
  }
  return [...records.values()];
}

export function discoveryStatus(args: {
  candidates: CandidateRecord[];
  queriesAttempted: string[];
  reopened: boolean;
  stopReason?: string;
}): "open" | "bounded-complete" | "incomplete" {
  if (args.reopened) return "open";
  const exhaustion = args.stopReason === "hard_discovery_ceiling" || args.stopReason === "discovery_query_limit"
    || args.stopReason === "no_distinct_source_strategy" || args.stopReason === "no_distinct_public_criterion_query";
  if (exhaustion && args.queriesAttempted.length >= 2) {
    return args.candidates.length ? "bounded-complete" : "incomplete";
  }
  if (args.candidates.length === 0 && args.queriesAttempted.length > 0) return "incomplete";
  return "open";
}
