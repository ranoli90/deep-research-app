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
  const budget = text.match(/\bbudget\s+is\s+(\d+(?:[.,]\d+)?)/i) ?? text.match(/\bbudget\s+(\d+(?:[.,]\d+)?)/i);
  if (budget) {
    return { kind: "constraint_change", field: "budget", value: budget[1]!.replace(",", ""), relaxedHardConstraint: true, unknownDependencies: false };
  }
  for (const country of COUNTRIES) {
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
