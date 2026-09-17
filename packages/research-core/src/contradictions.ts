import type { Contradiction, ControllerState, StoredPassage, StoredSource } from "./types.js";

function sourceOf(state: ControllerState, passage: StoredPassage): StoredSource | undefined {
  return state.sources.find((s) => s.id === passage.sourceId);
}

function extractPrices(text: string): { value: string; num: number; units: string }[] {
  const out: { value: string; num: number; units: string }[] = [];
  const re = /(?:costs?|price[ds]?|listed at)\s+(\d+(?:\.\d+)?)\s*(EUR|USD|GBP)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ value: `${m[1]} ${m[2]}`, num: Number(m[1]), units: m[2]!.toUpperCase() });
  }
  return out;
}

function extractPercents(text: string): string[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => m[0]);
}

function scopeFrom(text: string): {
  dates: string[];
  geography?: string;
  population?: string;
  productVersion?: string;
  units?: string;
} {
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2}|20\d{2}|19\d{2})\b/g)].map((m) => m[1]!);
  const geo = text.match(/\b(germany|france|united states|usa|uk|eu-central-1|us-east-1)\b/i)?.[1];
  const population = text.match(/\b(children under \d+|pediatric|adults? over \d+|adults only|under-?5)\b/i)?.[1];
  const productVersion = text.match(/\b(postgres(?:ql)?\s*\d+|version\s*\d+|v\d+)\b/i)?.[1];
  const units = text.match(/\b(EUR|USD|GBP|mg|g|percent|seats|users)\b/i)?.[1];
  return { dates, geography: geo?.toLowerCase(), population: population?.toLowerCase(), productVersion: productVersion?.toLowerCase(), units: units?.toLowerCase() };
}

function scopesExplainDisagreement(a: ReturnType<typeof scopeFrom>, b: ReturnType<typeof scopeFrom>): string | null {
  if (a.geography && b.geography && a.geography !== b.geography) {
    return `Different geography (${a.geography} vs ${b.geography}); not resolved by recency.`;
  }
  if (a.population && b.population && a.population !== b.population) {
    return `Different population (${a.population} vs ${b.population}); not resolved by recency.`;
  }
  if (a.productVersion && b.productVersion && a.productVersion !== b.productVersion) {
    return `Different product/version (${a.productVersion} vs ${b.productVersion}); not resolved by recency.`;
  }
  if (a.units && b.units && a.units !== b.units) {
    return `Different units (${a.units} vs ${b.units}); values are not averaged.`;
  }
  const aDate = a.dates[0];
  const bDate = b.dates[0];
  if (aDate && bDate && aDate !== bDate && /^\d{4}/.test(aDate) && /^\d{4}/.test(bDate)) {
    return `Different dates (${aDate} vs ${bDate}); newest source is not automatically correct.`;
  }
  return null;
}

function compatStance(text: string): "yes" | "no" | null {
  if (/not compatible|incompatible|does not support|not supported/i.test(text)) return "no";
  if (/compatible with all|works (great )?with|broadly compatible|is compatible/i.test(text)) return "yes";
  return null;
}

/**
 * First-class contradictions. Newest source is never auto-correct.
 * Scope (version/date/geo/population/units) is checked before treating disagreement as unresolved conflict.
 */
export function detectContradictions(state: ControllerState): Contradiction[] {
  const existing = [...(state.contradictions ?? [])];
  const found: Contradiction[] = [];
  const passages = state.passages;

  for (let i = 0; i < passages.length; i++) {
    for (let j = i + 1; j < passages.length; j++) {
      const a = passages[i]!;
      const b = passages[j]!;
      const sa = sourceOf(state, a);
      const sb = sourceOf(state, b);
      const scopeA = scopeFrom(a.exactText);
      const scopeB = scopeFrom(b.exactText);
      const explained = scopesExplainDisagreement(scopeA, scopeB);

      const pricesA = extractPrices(a.exactText);
      const pricesB = extractPrices(b.exactText);
      if (pricesA[0] && pricesB[0] && pricesA[0].value !== pricesB[0].value) {
        found.push({
          id: `contradiction-price-${a.id}-${b.id}`,
          claimA: pricesA[0].value,
          claimB: pricesB[0].value,
          sourceA: sa?.locator ?? a.sourceId,
          sourceB: sb?.locator ?? b.sourceId,
          passageAId: a.id,
          passageBId: b.id,
          dates: [...scopeA.dates, ...scopeB.dates],
          geography: scopeA.geography ?? scopeB.geography,
          population: scopeA.population ?? scopeB.population,
          productVersion: scopeA.productVersion ?? scopeB.productVersion,
          units: pricesA[0].units,
          evidenceQuality: `${sa?.sourceType ?? "unknown"} vs ${sb?.sourceType ?? "unknown"}`,
          possibleExplanation: explained ?? "Genuinely conflicting figures for overlapping scope; both retained.",
          resolutionStatus: explained ? "explained" : "unresolved",
          resolutionEvidence: explained ?? undefined,
          impact: "Displayed price/eligibility remains conditional until resolved or explicitly left uncertain.",
          dimension: explained?.includes("geography") ? "geography" : explained?.includes("units") ? "units" : "value",
        });
      }

      const stanceA = compatStance(a.exactText);
      const stanceB = compatStance(b.exactText);
      if (stanceA && stanceB && stanceA !== stanceB) {
        found.push({
          id: `contradiction-compat-${a.id}-${b.id}`,
          claimA: stanceA === "yes" ? a.exactText.slice(0, 180) : a.exactText.slice(0, 180),
          claimB: b.exactText.slice(0, 180),
          sourceA: sa?.locator ?? a.sourceId,
          sourceB: sb?.locator ?? b.sourceId,
          passageAId: a.id,
          passageBId: b.id,
          dates: [...scopeA.dates, ...scopeB.dates],
          geography: scopeA.geography ?? scopeB.geography,
          productVersion: scopeA.productVersion ?? scopeB.productVersion,
          evidenceQuality: `${sa?.sourceType ?? "unknown"} vs ${sb?.sourceType ?? "unknown"}`,
          possibleExplanation:
            explained ??
            "Secondary summaries may overgeneralize; a version-specific primary matrix can disagree without either date winning automatically.",
          resolutionStatus: explained ? "explained" : "unresolved",
          resolutionEvidence: explained ?? undefined,
          impact: "Compatibility conclusion stays disputed until primary evidence is weighed; summaries are not treated as independent confirmation.",
          dimension: explained?.includes("version") ? "version" : "compatibility",
        });
      }

      const pctA = extractPercents(a.exactText);
      const pctB = extractPercents(b.exactText);
      if (pctA[0] && pctB[0] && pctA[0] !== pctB[0] && /completion|withdrawn|rate/i.test(a.exactText + b.exactText)) {
        found.push({
          id: `contradiction-pct-${a.id}-${b.id}`,
          claimA: pctA[0],
          claimB: pctB[0],
          sourceA: sa?.locator ?? a.sourceId,
          sourceB: sb?.locator ?? b.sourceId,
          passageAId: a.id,
          passageBId: b.id,
          units: "percent",
          evidenceQuality: `${sa?.sourceType ?? "unknown"} vs ${sb?.sourceType ?? "unknown"}`,
          possibleExplanation: explained ?? "Conflicting percentages; denominators and years must match before either is preferred.",
          resolutionStatus: explained ? "explained" : "unresolved",
          impact: "Numeric conclusion cannot be averaged across conflicting figures.",
          dimension: "value",
        });
      }
    }
  }

  const byId = new Map<string, Contradiction>();
  for (const c of [...existing, ...found]) byId.set(c.id, c);
  return [...byId.values()];
}

export function unresolvedContradictions(state: ControllerState): Contradiction[] {
  return (state.contradictions ?? detectContradictions(state)).filter((c) => c.resolutionStatus === "unresolved");
}
