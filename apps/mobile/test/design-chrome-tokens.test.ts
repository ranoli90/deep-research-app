import { describe, expect, it } from "vitest";
import { color } from "@deep/design";

describe("cream/ink/teal chrome tokens", () => {
  it("exposes composer, thinking, userBubble, and stop for light and dark", () => {
    for (const scheme of [color.light, color.dark] as const) {
      expect(scheme.composer.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(scheme.composer.sendFill).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(scheme.thinking.inkActive).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(scheme.userBubble.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(scheme.stop.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("keeps dark chrome on the warm cream/ink/teal family, not competitor clones", () => {
    const dark = color.dark;
    expect(dark.composer.fill).not.toBe("#0F0F0F");
    expect(dark.composer.sendFill.toLowerCase()).not.toBe("#10a37f");
    expect(dark.composer.sendFill.toLowerCase()).not.toBe("#19c37d");
    expect(dark.stop.fill).not.toBe("#000000");
    expect(dark.composer.sendFill).toBe(dark.accent);
    expect(dark.bg).toBe("#161412");
    expect(dark.ink).toBe("#F4EFE8");
  });
});
