export function providerFailureState(err: { name?: string; message?: string }): "failed" | "outcome-unknown" {
  const name = err.name ?? "";
  const message = err.message ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message)) {
    return "outcome-unknown";
  }
  return "failed";
}
