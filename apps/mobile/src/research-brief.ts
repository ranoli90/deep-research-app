/** Compact “Researching this…” surface from persisted brief flags. Never invent a plan. */

export type BriefConstraint = { field: string; value: string; origin?: string; importance?: string };
export type BriefAssumption = {
  value: string;
  reversibility?: string;
  userConfirmationState?: string;
  impact?: string;
};

export type ResearchBriefInput = {
  originalQuestion: string;
  revision: number;
  desiredOutcome?: string;
  geography?: string;
  constraints: BriefConstraint[];
  assumptions?: BriefAssumption[];
  freshnessRequirements?: string;
  /** Backend-owned: only show a blocking clarification when this is true or lifecycle is awaiting_input. */
  materialClarification?: boolean;
};

export type ResearchBriefView = {
  show: boolean;
  blocking: boolean;
  objective: string;
  assumptions: string[];
  materialClarification: string | null;
};

function assumptionLines(brief: ResearchBriefInput): string[] {
  const fromAssumptions = (brief.assumptions ?? [])
    .filter((a) => a.value.trim())
    .map((a) => a.value.trim());
  const freshness = brief.freshnessRequirements?.trim();
  const lines = freshness ? [...fromAssumptions, freshness] : fromAssumptions;
  if (lines.length > 0) return lines;
  return brief.constraints
    .filter((c) => c.origin === "assumed" || c.origin === "system")
    .map((c) => `${c.field}: ${c.value}`);
}

function consequentialUnconfirmed(brief: ResearchBriefInput): boolean {
  return (brief.assumptions ?? []).some(
    (a) => a.reversibility === "consequential" && a.userConfirmationState === "unconfirmed",
  );
}

export function clarificationFieldFromPrompt(prompt: string | null | undefined): string {
  const p = (prompt ?? "").toLowerCase();
  if (/jurisdiction|country|state|geography|where should/.test(p)) return "geography";
  if (/budget|currency|price ceiling|how much/.test(p)) return "budget";
  if (/use case|used for|workload/.test(p)) return "use_case";
  if (/population|who is this for/.test(p)) return "population";
  if (/timeframe|as of|which year/.test(p)) return "timeframe";
  if (/platform|android|ios|operating system|dock|device/.test(p)) return "platform";
  if (/private search|public web|uploaded document|attached documents/.test(p)) return "private_search";
  if (/company or product|which company/.test(p)) return "subject";
  return "detail";
}

export function clarificationPlaceholder(prompt: string | null | undefined): string {
  switch (clarificationFieldFromPrompt(prompt)) {
    case "geography": return "Jurisdiction or place";
    case "budget": return "Budget and currency";
    case "use_case": return "Intended use";
    case "population": return "Who it applies to";
    case "timeframe": return "Time window";
    case "platform": return "Platform or product";
    case "private_search": return "Yes or no — attached documents";
    case "subject": return "Named company or product";
    default: return "The missing detail";
  }
}

export function clarificationPlaceholderForField(field: string | null | undefined): string {
  switch (field) {
    case "geography": return "Jurisdiction or place";
    case "budget": return "Budget and currency";
    case "use_case": return "Intended use";
    case "population": return "Who it applies to";
    case "timeframe": return "Time window";
    case "platform": return "Platform or product";
    case "private_search": return "Yes or no — attached documents";
    case "subject": return "Named company or product";
    case "safety": return "The lawful outcome you need";
    case "currency": return "Budget and currency";
    default: return "The missing detail";
  }
}

/** Last public clarification label. Empty when no typed clarification activity exists. */
export function clarificationPromptFromEvents(
  events: { activity?: { kind?: string; label?: string } | null }[],
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const activity = events[i]?.activity;
    if (activity?.kind !== "clarification") continue;
    const label = activity.label?.trim();
    if (label) return label;
  }
  return null;
}

export function researchBriefView(args: {
  lifecycle?: string;
  status?: string;
  brief?: ResearchBriefInput | null;
  clarificationSummary?: string | null;
  hasReport?: boolean;
}): ResearchBriefView {
  const hidden: ResearchBriefView = {
    show: false,
    blocking: false,
    objective: "",
    assumptions: [],
    materialClarification: null,
  };
  const awaiting = args.lifecycle === "awaiting_input" || args.status === "awaiting_input";
  if (args.hasReport && !awaiting) return hidden;
  const brief = args.brief;
  if (!brief) {
    if (!awaiting) return hidden;
    return {
      show: true,
      blocking: true,
      objective: "Need one detail before research can continue.",
      assumptions: [],
      materialClarification: args.clarificationSummary?.trim() || "Which jurisdiction should this answer apply to?",
    };
  }
  const material = brief.materialClarification === true || awaiting;
  const assumptions = assumptionLines(brief);
  const needsConfirm = consequentialUnconfirmed(brief);
  const early = !args.lifecycle || ["queued", "preparing", "awaiting_input"].includes(args.lifecycle);
  const show = material || (early && (needsConfirm || assumptions.length > 0));
  if (!show) return hidden;

  const objective =
    brief.desiredOutcome?.trim() ||
    `I'll research ${brief.originalQuestion.trim().replace(/\?+$/, "")}.`;
  return {
    show: true,
    blocking: material,
    objective,
    assumptions,
    materialClarification: material
      ? args.clarificationSummary?.trim() || "This detail would change what gets researched."
      : null,
  };
}
