export type CalcInput = {
  name: string;
  value: number;
  units: string;
  sourceClaimId?: string;
};

export type CalcResult = {
  formulaName: string;
  formulaVersion: string;
  inputs: CalcInput[];
  output: number;
  units: string;
  expression: string;
};

export type CalcOutcome =
  | { status: "computed"; result: CalcResult }
  | { status: "unknown"; missing: string[]; formulaName: string };

const REQUIRED_INPUTS: Record<string, string[]> = {
  annual_from_monthly: ["monthly"],
  grams_to_milligrams: ["grams"],
  percent_difference: ["left", "right"],
  date_interval_days: ["startMs", "endMs"],
};

/** Missing inputs stay unknown. Never invent a number. */
export function tryCalculate(formulaName: string, inputs: CalcInput[]): CalcOutcome {
  const required = REQUIRED_INPUTS[formulaName];
  if (!required) return { status: "unknown", missing: ["formula"], formulaName };
  const missing = required.filter((n) => {
    const found = inputs.find((i) => i.name === n);
    return !found || !Number.isFinite(found.value);
  });
  if (missing.length) return { status: "unknown", missing, formulaName };
  try {
    return { status: "computed", result: calculate(formulaName, inputs) };
  } catch {
    return { status: "unknown", missing: ["evaluation"], formulaName };
  }
}

export function calculate(formulaName: string, inputs: CalcInput[]): CalcResult {
  if (formulaName === "annual_from_monthly") {
    const monthly = inputs.find((i) => i.name === "monthly") ?? inputs[0];
    const months = inputs.find((i) => i.name === "months") ?? { name: "months", value: 12, units: "month" };
    if (!monthly) throw new Error("missing monthly");
    const output = monthly.value * months.value;
    return {
      formulaName,
      formulaVersion: "1",
      inputs: [monthly, months],
      output,
      units: monthly.units,
      expression: `${monthly.value} ${monthly.units} × ${months.value} ${months.units} = ${output} ${monthly.units}`,
    };
  }
  if (formulaName === "grams_to_milligrams") {
    const grams = inputs[0];
    if (!grams) throw new Error("missing grams");
    const output = grams.value * 1000;
    return {
      formulaName,
      formulaVersion: "1",
      inputs: [grams],
      output,
      units: "mg",
      expression: `${grams.value} g × 1000 = ${output} mg`,
    };
  }
  if (formulaName === "percent_difference") {
    const left = inputs.find((i) => i.name === "left") ?? inputs[0];
    const right = inputs.find((i) => i.name === "right") ?? inputs[1];
    if (!left || !right) throw new Error("missing left/right");
    if (left.value === 0) throw new Error("division by zero");
    const output = ((right.value - left.value) / left.value) * 100;
    const rounded = Math.round(output * 100) / 100;
    return {
      formulaName,
      formulaVersion: "1",
      inputs: [left, right],
      output: rounded,
      units: "percent",
      expression: `((${right.value} - ${left.value}) / ${left.value}) × 100 = ${rounded}%`,
    };
  }
  if (formulaName === "date_interval_days") {
    const start = inputs.find((i) => i.name === "startMs") ?? inputs[0];
    const end = inputs.find((i) => i.name === "endMs") ?? inputs[1];
    if (!start || !end) throw new Error("missing dates");
    const output = Math.round((end.value - start.value) / 86_400_000);
    return {
      formulaName,
      formulaVersion: "1",
      inputs: [start, end],
      output,
      units: "day",
      expression: `(${end.value} - ${start.value}) / 86400000 = ${output} day`,
    };
  }
  throw new Error(`unknown formula ${formulaName}`);
}

export function extractMonthlyPrice(text: string): { value: number; units: string } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(EUR|USD|GBP)\s*(?:per month|\/\s*month|\/month)/i);
  if (!m) return null;
  return { value: Number(m[1]), units: m[2]!.toUpperCase() };
}
