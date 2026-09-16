import { describe, expect, it } from "vitest";
import { assertSafeUrl, isBlockedIp } from "../src/platform/ssrf.js";

describe("S02 safe fetch guards", () => {
  it("blocks loopback, private, metadata, and credential URLs", async () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertSafeUrl("http://localhost/")).rejects.toThrow();
    await expect(assertSafeUrl("http://user:pass@example.com/")).rejects.toThrow();
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow();
  });
});
