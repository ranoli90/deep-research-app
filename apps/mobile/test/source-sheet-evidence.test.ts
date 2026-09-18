import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sourceDomain } from "../src/source-view";
import { uncertaintyFromSource, uncertaintyLabel } from "../src/uncertainty";

it("source sheet shows passage, publisher, location, access, quality, and challenge/verify", () => {
  const src = readFileSync(join(import.meta.dirname, "../src/SourceSheet.tsx"), "utf8");
  expect(src).toContain("source.title");
  expect(src).toContain("source.publisher");
  expect(src).toContain("source.exactText");
  expect(src.indexOf("source.exactText")).toBeLessThan(src.indexOf("source.title"));
  expect(src).toContain("sourceLocation(source)");
  expect(src).toContain("uncertaintyLabel(quality)");
  expect(src).toContain('accessibilityLabel="Related claim"');
  expect(src).toContain("Challenge this conclusion");
  expect(src).toContain("Request targeted verification");
  expect(src).toContain("Open original source");
  expect(src).toContain("Close source sheet");
  expect(sourceDomain("https://www.example.org/spec")).toBe("example.org");
  expect(uncertaintyLabel(uncertaintyFromSource({ accessLevel: "full-text", coverage: "complete" }))).toBe("Supportable");
});
