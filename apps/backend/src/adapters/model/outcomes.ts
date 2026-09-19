export function providerFailureState(err: { name?: string; message?: string }): "failed" | "outcome-unknown" {
  const name = err.name ?? "";
  const message = err.message ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message)) {
    return "outcome-unknown";
  }
  return "failed";
}

/** Null-cost HTTP 404s are known failures, not unknown holds. Only true unknown outcomes HOLD. */
export function providerIntentStateForResult(result: {
  status: string;
  receipt: { actualMicro: number | null };
}): { state: "confirmed" | "outcome-unknown" | "failed"; confirmedMicro?: number } {
  if (result.status === "outcome_unknown") return { state: "outcome-unknown" };
  // A 200 with unusable JSON and no usage is an unknown spend, not a null-cost 404.
  if (result.status === "invalid_output" && result.receipt.actualMicro == null) return { state: "outcome-unknown" };
  if (result.receipt.actualMicro != null) return { state: "confirmed", confirmedMicro: result.receipt.actualMicro };
  return { state: "failed" };
}
