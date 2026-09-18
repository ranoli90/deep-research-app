import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("production/preview stay HTTPS-only; cleartext is an explicit debug profile flag", () => {
  const app = JSON.parse(readFileSync(join(import.meta.dirname, "../app.json"), "utf8"));
  expect(app.expo.android.usesCleartextTraffic).not.toBe(true);
  expect(app.expo.plugins).toContain("./plugins/with-cleartext.js");
  const plugin = readFileSync(join(import.meta.dirname, "../plugins/with-cleartext.js"), "utf8");
  expect(plugin).toContain("EXPO_PUBLIC_ALLOW_CLEARTEXT");
  expect(plugin).toContain("withAndroidManifest");
  expect(plugin).not.toMatch(/expo-build-properties/);
  const eas = JSON.parse(readFileSync(join(import.meta.dirname, "../eas.json"), "utf8"));
  expect(eas.build.device.env.EXPO_PUBLIC_ALLOW_CLEARTEXT).toBe("1");
  expect(eas.build.preview.env.EXPO_PUBLIC_ALLOW_CLEARTEXT).not.toBe("1");
  expect(eas.build.production.env.EXPO_PUBLIC_ALLOW_CLEARTEXT).not.toBe("1");
});
