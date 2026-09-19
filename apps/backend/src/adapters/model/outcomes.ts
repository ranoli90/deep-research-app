export function providerFailureState(err: { name?: string; message?: string }): "failed" | "outcome-unknown" {
  const name = err.name ?? "";
  const message = err.message ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted|network|fetch failed|ECONNRESET|ENOTFOUND/i.test(`${name} ${message}`)) {
    return "outcome-unknown";
  }
  return "failed";
}

/** Financial state is independent of availability failover. 429/5xx HOLD; 404 no-endpoint is known-zero. */
export function providerIntentStateForResult(result: {
  status: string;
  receipt: { actualMicro: number | null };
}): { state: "confirmed" | "outcome-unknown" | "failed"; confirmedMicro?: number } {
  if (result.status === "outcome_unknown") return { state: "outcome-unknown" };
  if (result.status === "transient_failure") return { state: "outcome-unknown" };
  // A 200 with unusable JSON and no usage is an unknown spend, not a null-cost 404.
  if (result.status === "invalid_output" && result.receipt.actualMicro == null) return { state: "outcome-unknown" };
  if (result.receipt.actualMicro != null) return { state: "confirmed", confirmedMicro: result.receipt.actualMicro };
  if (result.status === "permanent_failure") return { state: "failed", confirmedMicro: 0 };
  return { state: "failed", confirmedMicro: 0 };
}

/** Repair/second paid call only after a confirmed or known-failed financial outcome. */
export function knownFinancialOutcome(result: {
  status: string;
  receipt: { actualMicro: number | null };
}): boolean {
  return providerIntentStateForResult(result).state !== "outcome-unknown";
}
