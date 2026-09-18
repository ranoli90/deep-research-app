import type { Constraint } from "@deep/contracts";
import type { StoredClaim, StoredSource, StoredPassage } from "./types.js";
import { extractCandidates } from "./candidates.js";
import { extractMonthlyPrice, tryCalculate } from "./calculate.js";

export type ReportDerivation = "supplied-constraints" | "source-counts" | "statement-classes" | "candidate-table" | "candidate-listing" | "candidate-eligibility" | "evidence-comparison" | "access-limits" | "annual-calculation" | "percentage-context" | "dated-statements" | "language-note" | "population-scope";
export type ReportDerivationContext = {
  constraints: Constraint[];
  sources: StoredSource[];
  claims: StoredClaim[];
  passages: StoredPassage[];
};

/** Closed deterministic renderers. Publication rebuilds inputs from the owned run, not model prose. */
export function deriveReportText(kind: ReportDerivation, context: ReportDerivationContext, passageIds: string[] = []): string {
  switch (kind) {
    case "candidate-eligibility": {
      const candidates = extractCandidates(context.passages, context.constraints);
      const eligible = candidates.filter((c) => c.feasibility === "satisfies");
      const ineligible = candidates.filter((c) => c.feasibility === "violates");
      const unknown = candidates.filter((c) => c.feasibility === "unknown");
      if (candidates.length && ineligible.length === candidates.length) return `None of the inspected candidates meet the hard constraints (${ineligible.map((c) => c.identity).join(", ")}). This is a bounded result over the inspected set, not a claim that no option exists outside it.`;
      return `Eligible: ${eligible.map((c) => c.identity).join(", ") || "none verified"}. Ineligible: ${ineligible.map((c) => `${c.identity} (${c.excludedBy})`).join(", ") || "none verified"}. Unknown: ${unknown.map((c) => c.identity).join(", ") || "none among inspected candidates"}. Discovery remains open beyond the inspected set.`;
    }
    case "access-limits":
      return `${context.sources.filter((s) => s.accessLevel === "blocked" || s.accessLevel === "snippet").length} source(s) remain snippet-only or blocked. The report does not claim full reading of those pages.`;
    case "annual-calculation": {
      const price = context.passages.map((p) => extractMonthlyPrice(p.exactText)).find(Boolean);
      const result = tryCalculate("annual_from_monthly", price ? [{ name: "monthly", value: price.value, units: price.units }, { name: "months", value: 12, units: "month" }] : []);
      return result.status === "computed" ? `Calculation ${result.result.formulaName}@${result.result.formulaVersion}: ${result.result.expression}. Assumes twelve months at the quoted monthly rate; unreported taxes and price changes are excluded.` : "Annual cost remains unknown because a monthly input is missing.";
    }
    case "percentage-context":
      return `Inspected percentage statements: ${context.passages.filter((p) => /\d+(?:\.\d+)?%\s+of\s+[\d,]+\s+\w+/i.test(p.exactText)).map((p) => `“${p.exactText}”`).join("; ")}. These figures are not averaged; their denominators must be considered separately.`;
    case "dated-statements":
      return `Dated source statements: ${context.passages.filter((p) => /\bas of\s+(?:20\d{2}|19\d{2})|\bfounded in\s+(?:19\d{2}|20\d{2})/i.test(p.exactText)).map((p) => `“${p.exactText}”`).join("; ")}. Historical wording is retained; current price remains unverified.`;
    case "language-note": {
      const source = context.sources.find((s) => s.language && s.language !== "en");
      return source ? `Original language: ${source.language}. Translated wording is not a verbatim original quote; translation accuracy remains unverified.` : "Original language remains unverified.";
    }
    case "population-scope": {
      const qualifier = context.passages.map((p) => p.exactText.match(/\badults? over \d+|\badults only|\bchildren under \d+/i)?.[0]).find(Boolean);
      return qualifier ? `Inspected population qualifier: “${qualifier}”. This evidence does not support an unqualified claim about everyone.` : "Population scope remains unverified.";
    }
    case "evidence-comparison": {
      const selected = passageIds.map((id) => context.passages.find((p) => p.id === id));
      if (selected.length !== 2 || new Set(passageIds).size !== 2 || selected.some((p) => !p)) return "";
      return `Potential disagreement requiring scope comparison: “${selected[0]!.exactText}” versus “${selected[1]!.exactText}”. Newest source is not automatically correct. Resolution remains unverified; values are not averaged.`;
    }
    case "candidate-table":
      return ["Vendor | Region | Price | Currency | Status | Evidence",
        ...extractCandidates(context.passages, context.constraints).map((c) =>
          `${c.identity} | ${c.region ?? "—"} | ${c.price ?? "—"} | ${c.currency ?? "—"} | ${c.excludedBy ? `ineligible (${c.excludedBy})` : c.feasibility} | ${c.discoveredFrom.slice(0, 8)}`)].join("\n");
    case "candidate-listing":
      return extractCandidates(context.passages, context.constraints).map((c) => {
        const passage = context.passages.find((p) => p.id === c.discoveredFrom);
        const source = context.sources.find((s) => s.id === passage?.sourceId);
        return `${c.identity.padEnd(14)} ${(c.price == null ? "—" : `${c.price} ${c.currency ?? ""}`.trim()).padEnd(12)} ${c.feasibility.padEnd(10)} ${source?.locator ?? c.discoveredFrom}`;
      }).join("\n");
    case "supplied-constraints":
      return `Recorded criteria for this run: ${context.constraints.map((c) => `${c.field}=${c.value}${c.units ? " " + c.units : ""}`).join("; ")}.`;
    case "source-counts": {
      const clusters = new Set(context.sources.map((s) => s.originCluster ?? s.id));
      return `Recorded ${context.sources.length} source(s) in ${clusters.size} origin cluster(s). Repeated syndication is not counted as independent confirmation.`;
    }
    case "statement-classes": {
      const atomic = context.claims.filter((c) => !c.derivation && c.supportStatus !== "withdrawn");
      const facts = atomic.filter((c) => c.type === "external-fact");
      const inferences = atomic.filter((c) => c.type === "inference");
      // Never truncate a statement and thereby discard its qualifier.
      return `FACT: ${facts.map((c) => c.text).join(" | ") || "none recorded"}. CALCULATION: see calculation blocks. INFERENCE: ${inferences.map((c) => c.text).join(" | ") || "none presented as fact"}. UNCERTAINTY: see listed limitations.`;
    }
  }
}
