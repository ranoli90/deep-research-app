/** Keep the original goal when the user only changes a constraint. */
export function revisedQuestionForConstraintDelta(originalQuestion: string, delta: string): string {
  const original = originalQuestion.trim();
  const change = delta.trim();
  if (!change) return original;
  if (!original) return change;
  if (change.toLowerCase().includes(original.toLowerCase().slice(0, Math.min(24, original.length)))) return change;
  return `${original} ${change}`;
}

export function mutatingFollowUpKey(runId: string, revision: number, message: string): string {
  const body = `${runId}:${revision}:${message.trim()}`;
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) hash = (hash * 31 + body.charCodeAt(i)) | 0;
  return `${runId}-followup-${revision}-${(hash >>> 0).toString(16)}`.slice(0, 200);
}

/** Child identity from a mutating follow-up or assumption replace; never poll the parent when a child is returned. */
export async function adoptReturnedChild(args: {
  parentRunId: string;
  body: { runId?: unknown };
  selectRun: (runId: string) => void;
  refresh: (runId: string) => Promise<void>;
  poll: (runId: string) => void;
}): Promise<string> {
  const runId = typeof args.body.runId === "string" && args.body.runId ? args.body.runId : args.parentRunId;
  if (runId !== args.parentRunId) args.selectRun(runId);
  await args.refresh(runId);
  if (runId !== args.parentRunId) args.poll(runId);
  return runId;
}
