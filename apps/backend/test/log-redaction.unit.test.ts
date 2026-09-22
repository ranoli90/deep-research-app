import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCategory, logError, logInfo, redact } from "../src/platform/log.js";

const SENTINEL = "SYNTHETIC_NOT_A_REAL_CREDENTIAL";

afterEach(() => vi.restoreAllMocks());

describe("R06 safe logging", () => {
  it("redacts a short bearer sentinel under a generic err field", () => {
    expect(redact({ err: `Bearer ${SENTINEL}` })).toMatchObject({ err: "[redacted]" });
  });

  it("redacts a long bearer sentinel instead of leaking its prefix", () => {
    const long = redact({ err: `Bearer ${SENTINEL} ` + "x".repeat(600) }) as { err: string };
    expect(long.err).toBe("[redacted]");
    expect(long.err.includes(SENTINEL)).toBe(false);
  });

  it("redacts nested and long PEM, cookie, credential-URL and key-shaped secrets", () => {
    const nested = redact({
      provider: {
        detail: `-----BEGIN ${"RSA "}PRIVATE KEY-----\n${SENTINEL}\n-----END PRIVATE KEY-----`,
        cookies: `Set-Cookie: session=${SENTINEL}; HttpOnly`,
        location: `https://user:${SENTINEL}@provider.example.test/v1?key=${SENTINEL}`,
        apiKey: `sk-${SENTINEL}0123456789`,
        question: "how much does a synthetic laptop cost",
      },
    }) as Record<string, Record<string, unknown>>;
    const serialized = JSON.stringify(nested);
    expect(serialized.includes(SENTINEL)).toBe(false);
    expect(serialized.includes("BEGIN")).toBe(false);
  });

  it("keeps non-sensitive correlation ids and short status text", () => {
    const safe = redact({ correlationId: "corr_abc123", status: 500, reason: "database_or_queue_unavailable" });
    expect(safe).toEqual({ correlationId: "corr_abc123", status: 500, reason: "database_or_queue_unavailable" });
  });

  it("errorCategory never returns message or stack text", () => {
    const error = Object.assign(new Error(`request failed Bearer ${SENTINEL}`), { code: "ECONNRESET" });
    const category = errorCategory(error);
    expect(category).toEqual({ name: "Error", code: "ECONNRESET" });
    expect(JSON.stringify(category).includes(SENTINEL)).toBe(false);
  });

  it("emitted JSON log lines never contain a long bearer sentinel", () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    logInfo("worker_job", { runId: "run_1", note: `Bearer ${SENTINEL} ` + "x".repeat(600) });
    logError("worker_job_failed", { runId: "run_1", error: errorCategory(new Error(`Bearer ${SENTINEL}`)) });
    const all = lines.join("\n");
    expect(all.includes(SENTINEL)).toBe(false);
    expect(all.includes("run_1")).toBe(true);
    expect(all.includes("worker_job_failed")).toBe(true);
  });
});
