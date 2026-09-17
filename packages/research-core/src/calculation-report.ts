import type { EvidenceCalculationResult } from "@deep/contracts";
export const CALCULATION_REPORT_VERSION="calculation-report.v1";
/** Exact arithmetic, visibly separate from a claim about a real-world aggregate. */
export function calculationReportText(result:EvidenceCalculationResult,inputStatements:string[]):string|null {
 if(result.status!=="computed"||!result.output||inputStatements.length!==result.inputs.length)return null;
 const quantity=(value:string,unit:string,period:string|null)=>`${value} ${unit}${period?` per ${period}`:""}`;
 const operands=result.inputs.map(i=>`(${quantity(i.value,i.unit,i.billingPeriod)})`);
 const expression=result.formula==="annual_cost"?`${operands[0]} × 12 months`
  :result.formula==="percentage"?`${operands[0]} ÷ ${operands[1]} × 100`
  :operands.join(({sum:" + ",difference:" − ",product:" × ",ratio:" ÷ "} as Record<string,string>)[result.formula]!);
 const output=result.output;
 const value=output.denominator==="1"?output.numerator:`${output.numerator}/${output.denominator}`;
 const label={sum:"Sum",difference:"Difference",product:"Product",ratio:"Ratio",percentage:"Percentage",annual_cost:"Annual cost"}[result.formula];
 return `${label}: ${expression} = ${quantity(value,output.unit,output.billingPeriod)}. `+
  inputStatements.map((s,i)=>`Input ${i+1}: ${s}`).join(" ")+" "+result.assumptions.join(" ");
}
