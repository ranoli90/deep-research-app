import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl, isBlockedIp, safeFetch } from "../src/platform/ssrf.js";
import * as transport from "../src/platform/pinned-http.js";

describe("S02 safe fetch guards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      vi.spyOn(transport, "pinnedRequest").mockImplementation(async (input) => {
        const u = input.href;
        fetched.push(u);
        return { status: 302, headers: { location }, bytes: Buffer.alloc(0) };
      });
      await expect(safeFetch("http://1.1.1.1/public")).rejects.toThrow(/ip_blocked|host_blocked|resolved_ip_blocked|scheme_blocked/);
      expect(fetched.some((u) => /169\.254|127\.0\.0\.1|10\.1\.2\.3|localhost|\[::1\]/.test(u))).toBe(false);
      expect(fetched).toHaveLength(1);
      vi.restoreAllMocks();
    }
  });
  it.each(["::", "::ffff:7f00:1", "::ffff:127.0.0.1", "ff02::1", "2002:7f00:1::", "198.18.0.1", "224.0.0.1"])("V6-F12 blocks special address %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it("V6-F12 pins the validated address and stops redirect loops", async () => {
    const request = vi.spyOn(transport, "pinnedRequest").mockResolvedValue({ status: 302, headers: { location: "/public" }, bytes: Buffer.alloc(0) });
    await expect(safeFetch("https://1.1.1.1/public")).rejects.toThrow("redirect_loop");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({ address: "1.1.1.1", family: 4 });
  });
  it("V6-F12 bounds distinct redirects and blocks unapproved ports", async () => {
    let hop = 0;
    const request = vi.spyOn(transport, "pinnedRequest").mockImplementation(async () => ({ status: 302, headers: { location: `/next-${++hop}` }, bytes: Buffer.alloc(0) }));
    await expect(safeFetch("https://1.1.1.1/public")).rejects.toThrow("redirect_limit");
    expect(request).toHaveBeenCalledTimes(6);
    await expect(assertSafeUrl("https://1.1.1.1:5432/")).rejects.toThrow("port_blocked");
  });
});
