export type FollowUpExplain = {
  accountId: string;
  runId: string;
  reportId: string | null;
  question: string;
  answer: string;
  evidenceComplete: boolean;
  citationPassageIds: string[];
};

export function readFollowUpExplain(value: unknown): FollowUpExplain | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Saved follow-up explanation is invalid.");
  const v = value as Record<string, unknown>;
  if (typeof v.accountId !== "string" || !v.accountId) throw new Error("Saved follow-up explanation is invalid.");
  if (typeof v.runId !== "string" || !v.runId) throw new Error("Saved follow-up explanation is invalid.");
  if (v.reportId !== null && typeof v.reportId !== "string") throw new Error("Saved follow-up explanation is invalid.");
  if (typeof v.question !== "string" || typeof v.answer !== "string") throw new Error("Saved follow-up explanation is invalid.");
  if (typeof v.evidenceComplete !== "boolean") throw new Error("Saved follow-up explanation is invalid.");
  if (!Array.isArray(v.citationPassageIds) || v.citationPassageIds.some((id) => typeof id !== "string")) {
    throw new Error("Saved follow-up explanation is invalid.");
  }
  return {
    accountId: v.accountId,
    runId: v.runId,
    reportId: v.reportId,
    question: v.question,
    answer: v.answer,
    evidenceComplete: v.evidenceComplete,
    citationPassageIds: v.citationPassageIds,
  };
}

export function bindFollowUpExplain(args: {
  accountId: string;
  runId: string;
  reportId: string | null;
  question: string;
  answer: string;
  evidenceComplete: boolean;
  citationPassageIds: unknown;
}): FollowUpExplain {
  const citationPassageIds = Array.isArray(args.citationPassageIds)
    ? args.citationPassageIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    accountId: args.accountId,
    runId: args.runId,
    reportId: args.reportId,
    question: args.question,
    answer: args.answer,
    evidenceComplete: args.evidenceComplete,
    citationPassageIds,
  };
}

export function visibleFollowUpExplain(
  explanation: FollowUpExplain | null | undefined,
  args: { accountId: string | null; runId: string | null | undefined; reportId: string | null | undefined },
): FollowUpExplain | null {
  if (!explanation || !args.accountId || !args.runId) return null;
  if (explanation.accountId !== args.accountId) return null;
  if (explanation.runId !== args.runId) return null;
  if (explanation.reportId !== (args.reportId ?? null)) return null;
  return explanation;
}
