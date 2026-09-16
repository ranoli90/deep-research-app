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
  throw new Error(`unknown formula ${formulaName}`);
}

export function extractMonthlyPrice(text: string): { value: number; units: string } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(EUR|USD|GBP)\s*(?:per month|\/\s*month|\/month)/i);
  if (!m) return null;
  return { value: Number(m[1]), units: m[2]!.toUpperCase() };
}
