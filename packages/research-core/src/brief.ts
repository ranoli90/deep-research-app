import type { Assumption, Constraint, ResearchBrief } from "@deep/contracts";

const COUNTRIES = [
  "germany",
  "france",
  "united states",
  "usa",
  "uk",
  "united kingdom",
  "canada",
  "japan",
  "india",
  "australia",
  "brazil",
  "spain",
  "italy",
  "netherlands",
  "sweden",
  "norway",
  "singapore",
];

export function extractConstraints(question: string): Constraint[] {
  const constraints: Constraint[] = [];
  const lower = question.toLowerCase();

  for (const country of COUNTRIES) {
    if (lower.includes(country)) {
      constraints.push({
        id: `geo-${country.replace(/\s+/g, "-")}`,
        field: "geography",
        operator: "eq",
        value: country,
        origin: "explicit",
        importance: "hard",
        explanation: `Question names geography: ${country}`,
      });
      break;
    }
  }

  const money = question.match(/(\d+(?:[.,]\d+)?)\s*(EUR|USD|GBP|€|\$)/i);
  if (money) {
    constraints.push({
      id: "budget",
      field: "budget",
      operator: "lte",
      value: money[1]!.replace(",", ""),
      units: money[2]!.replace("€", "EUR").replace("$", "USD"),
      origin: "explicit",
      importance: "hard",
      explanation: `Question names budget ${money[0]}`,
    });
  }

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

  return constraints;
}

export function neededClarifications(brief: Pick<ResearchBrief, "originalQuestion" | "constraints">): string[] {
  const q = brief.originalQuestion.toLowerCase();
  const fields = new Set(brief.constraints.map((c) => c.field));
  const questions: string[] = [];

  const needsJurisdiction =
    /\b(tax|employment law|filing|legal status|which law applies)\b/i.test(q) &&
    !fields.has("geography") &&
    !/\b(germany|france|usa|united states|uk|canada)\b/i.test(q);
  if (needsJurisdiction) {
    questions.push("Which jurisdiction should this answer apply to?");
  }
  return questions;
}

export function parseCorrection(text: string): { field?: string; value?: string; relaxedHardConstraint: boolean } {
  const budget = text.match(/budget.{0,24}(\d+(?:[.,]\d+)?)\s*(EUR|USD|GBP|€|\$)?/i);
  if (budget) {
    return { field: "budget", value: budget[1], relaxedHardConstraint: true };
  }
  if (/actually,?\s+include/i.test(text) || /relax/i.test(text) || /no longer required/i.test(text)) {
    return { relaxedHardConstraint: true };
  }
  return { relaxedHardConstraint: false };
}

export function applyCorrectionToConstraints(
  constraints: Constraint[],
  correction: string,
): { next: Constraint[]; reopenedDiscovery: boolean } {
  const parsed = parseCorrection(correction);
  const next = constraints.map((c) => ({ ...c }));
  let reopenedDiscovery = false;
  if (parsed.field === "budget" && parsed.value) {
    const existing = next.find((c) => c.field === "budget");
    const prev = existing ? Number(existing.value) : undefined;
    const incoming = Number(parsed.value);
    if (existing) {
      existing.value = parsed.value;
      existing.origin = "confirmed";
      existing.explanation = `Corrected budget to ${parsed.value}`;
    } else {
      next.push({
        id: "budget",
        field: "budget",
        operator: "lte",
        value: parsed.value,
        origin: "confirmed",
        importance: "hard",
        explanation: "Budget supplied in correction",
      });
    }
    if (prev !== undefined && incoming > prev) reopenedDiscovery = true;
  }
  if (parsed.relaxedHardConstraint) reopenedDiscovery = true;
  return { next, reopenedDiscovery };
}

export function defaultAssumptions(): Assumption[] {
  return [];
}
