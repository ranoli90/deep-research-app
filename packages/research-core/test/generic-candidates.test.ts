import { expect, it } from "vitest";
import { extractCandidates } from "../src/candidates.js";
import { extractConstraints } from "../src/brief.js";

it("extracts unseen names without a fixture catalogue and requires affirmative platform evidence", () => {
  const criteria = extractConstraints("Android and iPhone required with offline editing and full export");
  const [candidate] = extractCandidates([{ id: "new-document", exactText: "ZephyrNote: Android, offline editing, and full export are supported." }], criteria);
  expect(candidate?.identity).toBe("ZephyrNote");
  expect(candidate?.feasibility).toBe("unknown");
  const [complete] = extractCandidates([{ id: "new-document", exactText: "ZephyrNote: Android, iPhone, offline editing, and full export are supported." }], criteria);
  expect(complete?.feasibility).toBe("satisfies");
});

it("keeps a region price separate from a later unavailable SKU", () => {
  const criteria = extractConstraints("Compare options in France under 100 EUR as of 2026-03-01");
  const [candidate] = extractCandidates([{ id: "unseen-pricing", exactText: "BorealisCloud costs 90 EUR in France as of 2026-03-01. A 9 EUR SKU is not available in France." }], criteria);
  expect(candidate?.identity).toBe("BorealisCloud");
  expect(candidate?.price).toBe(90);
  expect(candidate?.region).toBe("france");
  expect(candidate?.feasibility).toBe("satisfies");
});

it("missing dates and currency mismatches remain unknown, and unknown entities receive negative constraints", () => {
  const criteria = extractConstraints("Android required with iPhone and offline editing");
  const [candidate] = extractCandidates([{ id: "scope", exactText: "QuasarDesk: Android and offline editing are supported. iPhone is not supported." }], criteria);
  expect(candidate?.feasibility).toBe("violates");
  expect(candidate?.excludedBy).toBe("platform=iphone");
  const priced = extractCandidates([{ id: "p", exactText: "BorealisCloud costs 40 USD in France." }], extractConstraints("France under 50 EUR as of 2026-03-01"));
  expect(priced[0]?.feasibility).toBe("unknown");
});
