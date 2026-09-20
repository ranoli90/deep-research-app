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

export const FOLLOW_UP_EXPLAIN_MAX = 24;

export function readFollowUpExplains(value: unknown): FollowUpExplain[] {
  if (value == null) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows.map((row) => readFollowUpExplain(row)).filter((row): row is FollowUpExplain => row != null);
}

export function visibleFollowUpExplains(
  explanations: FollowUpExplain[] | null | undefined,
  args: { accountId: string | null; runId: string | null | undefined; reportId: string | null | undefined },
): FollowUpExplain[] {
  return (explanations ?? []).map((row) => visibleFollowUpExplain(row, args)).filter((row): row is FollowUpExplain => row != null);
}

export function appendFollowUpExplain(existing: FollowUpExplain[] | null | undefined, next: FollowUpExplain): FollowUpExplain[] {
  const kept = (existing ?? []).filter((row) =>
    row.accountId === next.accountId && row.runId === next.runId && row.reportId === next.reportId,
  );
  return [...kept, next].slice(-FOLLOW_UP_EXPLAIN_MAX);
}

/** Read-only explanations never clear an unresolved mutating journal. */
export function recordFollowUpExplain<T extends { pendingFollowUp?: unknown; followUpExplains?: FollowUpExplain[] | null }>(
  state: T,
  next: FollowUpExplain,
): T {
  return {
    ...state,
    followUpExplains: appendFollowUpExplain(state.followUpExplains, next),
  };
}
