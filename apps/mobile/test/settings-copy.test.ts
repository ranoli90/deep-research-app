import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("human settings copy", () => {
  it("omits engineering jargon and unavailable purchase entitlements", () => {
    const profile = readFileSync(join(import.meta.dirname, "../src/ProfilePanel.tsx"), "utf8");
    expect(profile).toMatch(/Purchases and push notifications are currently unavailable/);
    expect(profile).toMatch(/does not grant entitlement/);
    expect(profile).not.toMatch(/OpenRouter/);
    expect(profile).not.toMatch(/idempotency/);
    expect(profile).not.toMatch(/ZDR/);
    expect(profile).not.toMatch(/outbox/);
    expect(profile).not.toMatch(/model_policy/);
    expect(profile).not.toMatch(/Subscribe now/);
    expect(profile).not.toMatch(/\$9\.99/);
    expect(profile).toContain("Privacy & data");
    expect(profile).toContain("Research preferences");
    expect(profile).toContain("Source preferences");
    expect(profile).toContain("Help");
    expect(profile).toContain("About");
    expect(profile).toContain("Deep Research");
    expect(profile).toContain("settingsRow");
    const order = ["Account", "Appearance", "Research preferences", "Source preferences", "Privacy & data", "Help", "About"];
    const indexes = order.map((label) => profile.indexOf(`>${label}<`));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });
});
