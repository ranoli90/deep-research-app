import { formatChangeSummary, type ChangeSummary } from "./report-layout";

export type HumanChangeInput = ChangeSummary & {
  /** True when the server reran rather than selectively reusing evidence. */
  fullRerun?: boolean;
  previousAnswer?: string | null;
  currentAnswer?: string | null;
};

export function humanChangeSummary(input: HumanChangeInput): string {
  if (input.fullRerun) {
    const parts = [
      input.notes,
      "This update re-ran research rather than reusing the previous evidence set.",
    ];
    if (input.newlyFeasible && input.newlyFeasible.length > 0) {
      parts.push(`Newly feasible: ${input.newlyFeasible.join(", ")}.`);
    }
    if (input.newlyInfeasible && input.newlyInfeasible.length > 0) {
      parts.push(`Newly ineligible: ${input.newlyInfeasible.join(", ")}.`);
    }
    return parts.filter(Boolean).join(" ");
  }
  return formatChangeSummary(input);
}

export function versionComparisonCopy(input: {
  previousAnswer?: string | null;
  currentAnswer?: string | null;
  changeSummary?: HumanChangeInput | null;
}): { previous: string; current: string; why: string } {
  return {
    previous: input.previousAnswer?.trim() || "Earlier result kept.",
    current: input.currentAnswer?.trim() || "Current conclusion unavailable.",
    why: input.changeSummary ? humanChangeSummary(input.changeSummary) : "No change summary was recorded.",
  };
}
