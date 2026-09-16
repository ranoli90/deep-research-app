const SECRETISH = /(authorization|api[_-]?key|token|secret|password|cookie|question|originalQuestion|exact_text|extracted_text|prompt|document)/i;
const PRIVATE_HINTS = [/-----BEGIN/, /bearer [a-z0-9]/i];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 500) return `${value.slice(0, 80)}…[redacted ${value.length} chars]`;
    if (PRIVATE_HINTS.some((p) => p.test(value))) return "[redacted]";
    return value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Array.isArray(value) ? [] as unknown as Record<string, unknown> : {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRETISH.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ level: "info", event, ...redact(fields) as object, t: new Date().toISOString() }) + "\n");
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(JSON.stringify({ level: "error", event, ...redact(fields) as object, t: new Date().toISOString() }) + "\n");
}
