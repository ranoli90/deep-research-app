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
  status: string; reason?: string;
  receipt: { actualMicro: number | null; httpStatus?: number | null; providerId?: string | null };
}): { state: "confirmed" | "outcome-unknown" | "failed"; confirmedMicro?: number } {
  if (result.status === "outcome_unknown") return { state: "outcome-unknown" };
  if (result.receipt.actualMicro != null) return { state: "confirmed", confirmedMicro: result.receipt.actualMicro };
  if (result.status === "permanent_failure" && result.receipt.providerId == null &&
      [400,401,403,404,422].includes(result.receipt.httpStatus ?? 0) && /^provider_http_/.test(result.reason ?? ""))
    return { state: "failed", confirmedMicro: 0 };
  if(["credential_missing_or_cancelled", "invalid_model_deadline"].includes(result.reason ?? "")) return { state:"failed",confirmedMicro:0 };
  return { state: "outcome-unknown" };
}

/** Repair/second paid call only after a confirmed or known-failed financial outcome. */
export function knownFinancialOutcome(result: {
  status: string; reason?: string;
  receipt: { actualMicro: number | null; httpStatus?: number | null; providerId?: string | null };
}): boolean {
  return providerIntentStateForResult(result).state !== "outcome-unknown";
}
