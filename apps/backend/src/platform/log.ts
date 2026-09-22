const SENSITIVE_KEY = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|cookie|credential|private[_-]?key|client[_-]?secret|question|originalquestion|exact_text|extracted_text|prompt|document|stack)/i;

const PRIVATE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/,
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[baprs]|AKIA|whsec)[-_][A-Za-z0-9_-]{8,}\b/,
  /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/i,
  /:\/\/[^/\s:@]{1,}:[^/\s:@]{1,}@/,
  /(?:set-)?cookie\s*:/i,
];

function isPrivateString(value: string): boolean {
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(value));
}

const MAX_SAFE_STRING = 500;
const SAFE_TRUNCATED = 80;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (isPrivateString(value)) return "[redacted]";
    if (value.length > MAX_SAFE_STRING) return `${value.slice(0, SAFE_TRUNCATED)}…[redacted ${value.length} chars]`;
    return value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Array.isArray(value) ? [] as unknown as Record<string, unknown> : {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Safe, structured descriptor for a caught error. Never returns free-form message
 * or stack text, so provider/driver errors cannot leak credentials into logs.
 */
export function errorCategory(error: unknown): { name: string; code?: string } {
  if (error && typeof error === "object") {
    const candidate = error as { name?: unknown; code?: unknown };
    const name = typeof candidate.name === "string" && candidate.name.length > 0
      ? candidate.name.slice(0, 64)
      : "Error";
    const code = typeof candidate.code === "string" && candidate.code.length > 0
      ? candidate.code.slice(0, 64)
      : undefined;
    return code ? { name, code } : { name };
  }
  return { name: `non_error_${typeof error}` };
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ level: "info", event, ...redact(fields) as object, t: new Date().toISOString() }) + "\n");
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(JSON.stringify({ level: "error", event, ...redact(fields) as object, t: new Date().toISOString() }) + "\n");
}
