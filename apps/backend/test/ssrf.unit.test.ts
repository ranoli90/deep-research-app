import { afterEach, describe, expect, it } from "vitest";
import { assertSafeUrl, isBlockedIp, safeFetch } from "../src/platform/ssrf.js";

describe("S02 safe fetch guards", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("blocks loopback, private, metadata, and credential URLs", async () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fd12:3456:789a:1::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertSafeUrl("http://localhost/")).rejects.toThrow();
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertSafeUrl("http://user:pass@example.com/")).rejects.toThrow();
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("does not follow a redirect onto metadata, loopback, or private addresses", async () => {
    const targets = [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1/secret",
      "http://10.1.2.3/",
      "http://localhost/admin",
    ];
    for (const location of targets) {
      const fetched: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        fetched.push(u);
        return new Response(null, { status: 302, headers: { location } });
      }) as typeof fetch;
      await expect(safeFetch("http://1.1.1.1/public")).rejects.toThrow(/ip_blocked|host_blocked|resolved_ip_blocked|scheme_blocked/);
      expect(fetched.some((u) => /169\.254|127\.0\.0\.1|10\.1\.2\.3|localhost|\[::1\]/.test(u))).toBe(false);
      expect(fetched).toHaveLength(1);
    }
  });
});
