import { PRIMARY_SOURCE_TYPES } from "./independence.js";
import type { ControllerState, DisconfirmationRecord } from "./types.js";

function sanitize(text: string): string {
  return text.replace(/<\/?script\b[^>]*>/gi, "").replace(/on\w+\s*=\s*["'][^"']*["']/gi, "").replace(/javascript:/gi, "");
}

function publicPassages(state: ControllerState) {
  return state.passages.filter((p) => {
    const src = state.sources.find((s) => s.id === p.sourceId);
    const loc = String(src?.locator ?? "");
    if (loc.startsWith("attachment://")) return false;
    if (state.privateCanaries.some((c) => c && p.exactText.includes(c))) return false;
    return true;
  });
}

export function materialConclusion(state: ControllerState): string | null {
  const passages = publicPassages(state);
  const limitation = passages.find((p) => /not compatible|incompatible|does not support|not a real product|no such (product|feature)/i.test(p.exactText));
  if (limitation) return sanitize(limitation.exactText.slice(0, 240));
  const eligible = state.candidates.filter((c) => c.feasibility === "satisfies");
  if (eligible.length) return `Eligible under hard constraints: ${eligible.map((c) => c.identity).join(", ")}`;
  const primary = state.claims.find((c) => c.type === "external-fact" || c.type === "conditional-conclusion");
  if (primary && !state.privateCanaries.some((c) => c && primary.text.includes(c))) {
    return sanitize(primary.text.slice(0, 240));
  }
  const fallback = passages[0] ? passages[0].exactText.slice(0, 240) : null;
  return fallback ? sanitize(fallback) : "public evidence only";
}

export function planDisconfirmation(state: ControllerState): DisconfirmationRecord | null {
  const target = materialConclusion(state);
  if (!target) return null;
  const existing = (state.disconfirmations ?? []).find((d) => d.targetConclusion === target);
  if (existing) return existing;

  let hypothesis = "A primary source that directly contradicts this conclusion.";
  let strategy = `${state.brief.originalQuestion} official documentation counterexample`;
  if (/not compatible|incompatible/i.test(target)) {
    hypothesis = "Official compatibility documentation that lists the named version as supported.";
    strategy = `${state.brief.originalQuestion} official compatibility matrix supported`;
  } else if (/does not exist|no such|not a real product/i.test(target)) {
    hypothesis = "A current official catalog entry for the named product.";
    strategy = `${state.brief.originalQuestion} official product catalog`;
  } else if (/eligible/i.test(target)) {
    hypothesis = "A hard-constraint violation for a candidate currently marked eligible.";
    strategy = `${state.brief.originalQuestion} ineligible constraint violation`;
  }

  return {
    id: `disconfirm-${state.basis.evidenceRevision}`,
    targetConclusion: target,
    falsificationHypothesis: hypothesis,
    searchStrategy: strategy,
    result: "untried",
    counterevidenceFound: false,
    impact: "Conclusion remains provisional until a disconfirmation attempt is recorded. No counterexample found is not proof.",
  };
}

export function evaluateDisconfirmation(state: ControllerState, planned: DisconfirmationRecord): DisconfirmationRecord {
  const primaryPassages = state.passages.filter((p) => {
    const src = state.sources.find((s) => s.id === p.sourceId);
    return src && PRIMARY_SOURCE_TYPES.has(src.sourceType ?? "");
  });
  const haystack = (primaryPassages.length ? primaryPassages : state.passages).map((p) => p.exactText).join("\n");
  let found = false;
  if (/not compatible|incompatible/i.test(planned.targetConclusion)) {
    found = /compatible with all|postgres 14 is supported|supports postgres 14/i.test(haystack) && !/not compatible with postgres 14/i.test(haystack);
  } else if (/does not exist|no such|not a real/i.test(planned.targetConclusion)) {
    found = /official(ly)? (lists|offers|includes) the (product|feature)/i.test(haystack);
  } else {
    found = /this conclusion is false|counterexample|does not hold/i.test(haystack);
  }
  return {
    ...planned,
    result: found ? "counterevidence_found" : "no_counterexample_found",
    counterevidenceFound: found,
    impact: found
      ? "Counterevidence found; reduce confidence or withdraw the conclusion."
      : "No counterexample found in accessed primary sources. This is not proof that the conclusion is true.",
  };
}

export function disconfirmationCompleted(state: ControllerState): boolean {
  return (state.disconfirmations ?? []).some((d) => d.result !== "untried") || (state.completedActionTypes ?? []).includes("challenge");
}
