import type { Assumption, Constraint, ResearchBrief } from "@deep/contracts";
import { evaluateClarificationValue, clarificationPrompts } from "./clarification-value.js";
import { COUNTRIES, US_STATES, extractNamedGeography } from "./geography.js";
import { provenanceFromOrigin } from "./provenance.js";

function parseBudgetNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed.replace(/,/g, ""));
  if (/^\d+,\d{1,2}$/.test(trimmed)) return Number(trimmed.replace(",", "."));
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unitsFromSymbol(symbol: string | undefined): string | undefined {
  if (symbol === "$" || /^usd$/i.test(symbol ?? "")) return "USD";
  if (symbol === "€" || /^eur$/i.test(symbol ?? "")) return "EUR";
  if (symbol === "£" || /^gbp$/i.test(symbol ?? "")) return "GBP";
  return undefined;
}

/** Prefer an explicit ceiling ("under 2k" / "under $2000") over an incidental later price. */
export function parseBudgetCeiling(question: string): Constraint | null {
  const compact = question.match(/\b(?:under|below|at most|less than|<=)\s*(\$|€|£)?\s*(\d+(?:[.,]\d+)?)\s*[kK]\b(?:\s*(USD|EUR|GBP))?/i);
  if (compact) {
    const n = parseBudgetNumber(compact[2]!);
    if (n == null) return null;
    const units = unitsFromSymbol(compact[1] ?? compact[3]);
    return {
      id: "budget", field: "budget", operator: "lte", value: String(Math.round(n * 1000)),
      ...(units ? { units } : {}), origin: "explicit", importance: "hard",
      explanation: `Question names budget ceiling ${compact[0]}`,
      provenance: provenanceFromOrigin("explicit"),
    };
  }
  const prefixed = question.match(/\b(?:under|below|at most|less than|<=)\s*(\$|€|£)\s*(\d+(?:[.,]\d+)?)\b/i);
  if (prefixed) {
    const n = parseBudgetNumber(prefixed[2]!);
    if (n == null) return null;
    return {
      id: "budget", field: "budget", operator: "lte", value: String(n),
      units: unitsFromSymbol(prefixed[1]), origin: "explicit", importance: "hard",
      explanation: `Question names budget ceiling ${prefixed[0]}`,
      provenance: provenanceFromOrigin("explicit"),
    };
  }
  const suffixed = question.match(/\b(?:under|below|at most|less than|<=)\s*(\d+(?:[.,]\d+)?)\s*(EUR|USD|GBP|€|\$)/i);
  if (suffixed) {
    const n = parseBudgetNumber(suffixed[1]!);
    if (n == null) return null;
    return {
      id: "budget", field: "budget", operator: "lte", value: String(n),
      units: unitsFromSymbol(suffixed[2]), origin: "explicit", importance: "hard",
      explanation: `Question names budget ceiling ${suffixed[0]}`,
      provenance: provenanceFromOrigin("explicit"),
    };
  }
  const money = question.match(/(\d+(?:[.,]\d+)?)\s*(EUR|USD|GBP|€|\$)/i);
  if (!money) return null;
  const n = parseBudgetNumber(money[1]!);
  if (n == null) return null;
  return {
    id: "budget", field: "budget", operator: "lte", value: String(n),
    units: unitsFromSymbol(money[2]), origin: "explicit", importance: "hard",
    explanation: `Question names budget ${money[0]}`,
    provenance: provenanceFromOrigin("explicit"),
  };
}

export function extractConstraints(question: string): Constraint[] {
  const constraints: Constraint[] = [];
  const lower = question.toLowerCase();

  const geo = extractNamedGeography(question);
  if (geo) {
    constraints.push({
      id: `geo-${geo.value.replace(/\s+/g, "-")}`,
      field: "geography",
      operator: "eq",
      value: geo.value,
      origin: "explicit",
      importance: "hard",
      explanation: `Question names geography: ${geo.value}`,
      provenance: provenanceFromOrigin("explicit"),
    });
  }

  const ceiling = parseBudgetCeiling(question);
  if (ceiling) constraints.push(ceiling);

  const iso = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const asOf = question.match(/\bas of\s+([A-Za-z]+ \d{4}|\d{4}-\d{2}-\d{2}|\d{4})\b/i);
  if (iso) {
    constraints.push({
      id: "as-of-date",
      field: "date",
      operator: "eq",
      value: iso[1]!,
      origin: "explicit",
      importance: "hard",
      explanation: `Question names date ${iso[1]}`,
    });
  } else if (asOf) {
    constraints.push({
      id: "as-of-date",
      field: "date",
      operator: "eq",
      value: asOf[1]!,
      origin: "explicit",
      importance: "hard",
      explanation: `Question names date ${asOf[1]}`,
    });
  }

  const dose = question.match(/\b(\d+(?:\.\d+)?)\s*(mg|g|milligrams?|grams?)\b/i);
  if (dose) {
    const units = /g$|gram/i.test(dose[2]!) && !/^mg/i.test(dose[2]!) ? "g" : "mg";
    constraints.push({
      id: "dose",
      field: "dose",
      operator: "eq",
      value: dose[1]!,
      units,
      origin: "explicit",
      importance: "hard",
      explanation: `Question names dose ${dose[0]}`,
    });
  }

  if (/\biphone\b|\bios\b/i.test(lower)) {
    constraints.push({
      id: "platform-iphone",
      field: "platform",
      operator: "eq",
      value: "iphone",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires iPhone support",
    });
  }
  if (/\bandroid\b/i.test(lower)) {
    constraints.push({
      id: "platform-android",
      field: "platform",
      operator: "eq",
      value: "android",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires Android support",
    });
  }
  if (/\blinux\b/i.test(lower) && /\b(required|hard|also|desktop)\b/i.test(lower)) {
    constraints.push({
      id: "platform-linux",
      field: "platform",
      operator: "eq",
      value: "linux",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires Linux support",
    });
  }
  if (/\boffline editing\b/i.test(lower)) {
    constraints.push({
      id: "feature-offline",
      field: "feature",
      operator: "eq",
      value: "offline",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires offline editing",
    });
  }
  if (/\bfull export\b|\bexport required\b/i.test(lower)) {
    constraints.push({
      id: "feature-export",
      field: "feature",
      operator: "eq",
      value: "export",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires full export",
    });
  }

  const pop = question.match(/\b(children under \d+|pediatric|under-?5|adults? only)\b/i);
  if (pop) {
    constraints.push({
      id: "population",
      field: "population",
      operator: "eq",
      value: pop[1]!.toLowerCase(),
      origin: "explicit",
      importance: "hard",
      explanation: `Question names population ${pop[1]}`,
    });
  }

  const exclude = question.match(/\b(?:excluding|exclude|not including|without)\s+([A-Z][A-Za-z0-9-]+(?:\s+[A-Z][A-Za-z0-9-]+)?)/);
  if (exclude) {
    constraints.push({
      id: `exclude-${exclude[1]!.toLowerCase().replace(/\s+/g, "-")}`,
      field: "exclusion",
      operator: "neq",
      value: exclude[1]!,
      origin: "explicit",
      importance: "hard",
      explanation: `Question excludes ${exclude[1]}`,
    });
  }

  if (/\bprefer(?:ably)?\b|\bideally\b|\bnice to have\b/i.test(question)) {
    const prefer = question.match(/\bprefer(?:ably)?\s+([^.;]+)/i);
    constraints.push({
      id: "preference",
      field: "preference",
      operator: "eq",
      value: prefer?.[1]?.trim() ?? "stated preference",
      origin: "explicit",
      importance: "preference",
      explanation: "Soft preference; not a hard requirement",
    });
  }

  if (/\bcurrent\b|\blatest\b|\bas of now\b|\btoday\b/i.test(question) && !constraints.some((c) => c.field === "date")) {
    constraints.push({
      id: "freshness",
      field: "freshness",
      operator: "eq",
      value: "current",
      origin: "explicit",
      importance: "hard",
      explanation: "Question requires current/fresh evidence",
    });
  }

  for (const c of constraints) {
    if (!c.provenance) c.provenance = provenanceFromOrigin(c.origin);
  }

  return constraints;
}

export function neededClarifications(brief: Pick<ResearchBrief, "originalQuestion" | "constraints">): string[] {
  return clarificationPrompts(evaluateClarificationValue({
    originalQuestion: brief.originalQuestion,
    knownConstraints: brief.constraints,
  }));
}

export type CorrectionIntent = {
  kind: "constraint_change" | "unknown_dependencies" | "unparsed";
  field?: string;
  value?: string;
  units?: string;
  drop?: boolean;
  relaxedHardConstraint: boolean;
  unknownDependencies: boolean;
};

export function parseCorrection(text: string): CorrectionIntent {
  if (/dependency completeness unknown|dependencies? (are )?unknown/i.test(text)) {
    return { kind: "unknown_dependencies", relaxedHardConstraint: false, unknownDependencies: true };
  }
  const dose = text.match(/(\d+(?:\.\d+)?)\s*(mg|milligrams?|g|grams?)/i);
  if (dose && /dose|instead of|not \d/i.test(text)) {
    const units = /^mg|milligram/i.test(dose[2]!) ? "mg" : "g";
    return { kind: "constraint_change", field: "dose", value: dose[1], units, relaxedHardConstraint: false, unknownDependencies: false };
  }
  if (/\b(no budget|drop (the )?budget|without a budget|budget does not apply)\b/i.test(text)) {
    return { kind: "constraint_change", field: "budget", drop: true, relaxedHardConstraint: true, unknownDependencies: false };
  }
  const negatedBudget = /\b(not|no longer|don't|do not|without)\b[\s\S]{0,40}\b(under|below|budget|\$|€|£)\b/i.test(text)
    && !/\b(drop (the )?budget|no budget|without a budget)\b/i.test(text);
  const explicitCeiling = /\b(under|below|at most|less than|<=|budget is|raise(?: the)? budget|lower(?: the)? budget|change(?: the)? budget)\b/i.test(text);
  const ceiling = !negatedBudget && explicitCeiling ? parseBudgetCeiling(text) : null;
  if (ceiling) {
    return {
      kind: "constraint_change",
      field: "budget",
      value: ceiling.value,
      units: ceiling.units,
      relaxedHardConstraint: true,
      unknownDependencies: false,
    };
  }
  const raised = !negatedBudget
    ? text.match(/\b(?:raise|lower|change|set)\s+(?:the\s+)?budget\s+to\s+(\$|€|£)?\s*(\d+(?:[.,]\d+)?)(?:\s*(k))?(?:\s*(USD|EUR|GBP))?\b/i)
    : null;
  if (raised) {
    const n = parseBudgetNumber(raised[2]!);
    if (n != null) {
      const scaled = raised[3] ? Math.round(n * 1000) : n;
      const units = unitsFromSymbol(raised[1] ?? raised[4]);
      return {
        kind: "constraint_change",
        field: "budget",
        value: String(scaled),
        ...(units ? { units } : {}),
        relaxedHardConstraint: true,
        unknownDependencies: false,
      };
    }
  }
  const budget = !negatedBudget
    ? (text.match(/\bbudget\s+is\s+(\d+(?:[.,]\d+)?)/i) ?? text.match(/\bbudget\s+(\d+(?:[.,]\d+)?)/i))
    : null;
  if (budget) {
    return { kind: "constraint_change", field: "budget", value: budget[1]!.replace(",", ""), relaxedHardConstraint: true, unknownDependencies: false };
  }
  const namedPlaces = [...COUNTRIES, ...US_STATES.map((s) => s.name)];
  for (const country of namedPlaces) {
    const named = new RegExp(`\\b${country.replace(/\s+/g, "\\s+")}\\b`, "i").test(text);
    if (named && /required|instead|actually|must|use/i.test(text)) {
      return {
        kind: "constraint_change",
        field: "geography",
        value: country,
        relaxedHardConstraint: true,
        unknownDependencies: false,
      };
    }
  }
  if (/\blinux\b/i.test(text) && /\bno longer required|not required|optional|drop linux|without linux/i.test(text)) {
    return { kind: "constraint_change", field: "platform", value: "linux", drop: true, relaxedHardConstraint: true, unknownDependencies: false };
  }
  if (/\blinux\b/i.test(text) && /\b(required|also|hard|desktop)\b/i.test(text)) {
    return { kind: "constraint_change", field: "platform", value: "linux", relaxedHardConstraint: false, unknownDependencies: false };
  }
  if (/actually,?\s+include/i.test(text) || /relax/i.test(text) || /no longer required/i.test(text)) {
    return { kind: "constraint_change", relaxedHardConstraint: true, unknownDependencies: false };
  }
  return { kind: "unparsed", relaxedHardConstraint: false, unknownDependencies: false };
}

export function applyCorrectionToConstraints(
  constraints: Constraint[],
  correction: string,
): { next: Constraint[]; reopenedDiscovery: boolean } {
  const parsed = parseCorrection(correction);
  const next = constraints.map((c) => ({ ...c }));
  let reopenedDiscovery = false;
  if (parsed.field === "dose" && parsed.value) {
    const existing = next.find((c) => c.field === "dose");
    if (existing) {
      existing.value = parsed.value;
      if (parsed.units) existing.units = parsed.units;
      existing.origin = "confirmed";
      existing.explanation = `Corrected dose to ${parsed.value} ${parsed.units ?? existing.units ?? ""}`.trim();
    } else {
      next.push({
        id: "dose",
        field: "dose",
        operator: "eq",
        value: parsed.value,
        units: parsed.units,
        origin: "confirmed",
        importance: "hard",
        explanation: "Dose supplied in correction",
      });
    }
  }
  if (parsed.field === "budget" && parsed.drop) {
    const kept = next.filter((c) => c.field !== "budget");
    if (kept.length !== next.length) reopenedDiscovery = true;
    next.splice(0, next.length, ...kept);
  } else if (parsed.field === "budget" && parsed.value) {
    const existing = next.find((c) => c.field === "budget");
    const prev = existing ? Number(existing.value) : undefined;
    const incoming = Number(parsed.value);
    if (existing) {
      existing.value = parsed.value;
      existing.operator = "lte";
      if (parsed.units) existing.units = parsed.units;
      existing.origin = "confirmed";
      existing.explanation = `Corrected budget to ${parsed.value}${parsed.units ? ` ${parsed.units}` : ""}`;
    } else {
      next.push({
        id: "budget",
        field: "budget",
        operator: "lte",
        value: parsed.value,
        ...(parsed.units ? { units: parsed.units } : {}),
        origin: "confirmed",
        importance: "hard",
        explanation: "Budget supplied in correction",
        provenance: provenanceFromOrigin("confirmed"),
      });
    }
    if (prev !== undefined && incoming > prev) reopenedDiscovery = true;
  }
  if (parsed.field === "geography" && parsed.value) {
    const existing = next.find((c) => c.field === "geography");
    if (!existing || existing.value !== parsed.value) reopenedDiscovery = true;
    if (existing) {
      existing.value = parsed.value;
      existing.origin = "confirmed";
      existing.explanation = `Corrected geography to ${parsed.value}`;
    } else {
      next.push({
        id: `geo-${parsed.value.replace(/\s+/g, "-")}`,
        field: "geography",
        operator: "eq",
        value: parsed.value,
        origin: "confirmed",
        importance: "hard",
        explanation: `Correction requires ${parsed.value}`,
      });
    }
  }
  if (parsed.field === "platform" && parsed.value) {
    if (parsed.drop) {
      const kept = next.filter((c) => !(c.field === "platform" && c.value === parsed.value));
      if (kept.length !== next.length) reopenedDiscovery = true;
      next.splice(0, next.length, ...kept);
    } else if (!next.some((c) => c.field === "platform" && c.value === parsed.value)) {
      next.push({
        id: `platform-${parsed.value}`,
        field: "platform",
        operator: "eq",
        value: parsed.value,
        origin: "confirmed",
        importance: "hard",
        explanation: `Correction requires ${parsed.value}`,
      });
    }
  }
  if (parsed.relaxedHardConstraint) reopenedDiscovery = true;
  return { next, reopenedDiscovery };
}

export function inferOutputPreference(question: string): string | undefined {
  const q = question.toLowerCase();
  if (/\bconcise\b|\bbriefly\b|short answer/.test(q)) return "concise";
  if (/\bdetailed\b|in depth|full analysis/.test(q)) return "detailed";
  return undefined;
}

export function defaultAssumptions(): Assumption[] {
  return [];
}
