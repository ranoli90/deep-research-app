import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("device APK config plugin sets cleartext traffic without a new dependency", () => {
  const app = JSON.parse(readFileSync(join(import.meta.dirname, "../app.json"), "utf8"));
  expect(app.expo.android.usesCleartextTraffic).toBe(true);
  expect(app.expo.plugins).toContain("./plugins/with-cleartext.js");
  const plugin = readFileSync(join(import.meta.dirname, "../plugins/with-cleartext.js"), "utf8");
  expect(plugin).toContain('android:usesCleartextTraffic');
  expect(plugin).toContain("withAndroidManifest");
  expect(plugin).not.toMatch(/expo-build-properties/);
});
