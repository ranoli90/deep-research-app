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
