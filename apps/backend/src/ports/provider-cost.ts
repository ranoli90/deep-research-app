/** USD -> integer micro-USD, rounded upward; preserve raw receipt separately. */
export function costToMicro(raw: unknown): number | undefined {
  if (typeof raw !== "number" && typeof raw !== "string") return undefined;
  if (!Number.isFinite(Number(raw)) || Number(raw) < 0) return undefined;
  const match = String(raw).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  const scale = 6 + Number(match[3] ?? 0) - fraction.length;
  if (Math.abs(scale) > 100) return undefined;
  const digits = BigInt(match[1]! + fraction);
  const divisor = 10n ** BigInt(Math.max(0, -scale));
  const micro = scale >= 0 ? digits * 10n ** BigInt(scale) : (digits + divisor - 1n) / divisor;
  return micro <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micro) : undefined;
}
