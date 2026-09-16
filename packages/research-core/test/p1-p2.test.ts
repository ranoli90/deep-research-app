import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { extractCandidates } from "../src/candidates.js";
import { detectGaps } from "../src/gaps.js";
import { passageSupportsClaim } from "../src/support.js";
import { stripUnsafeMarkup } from "../src/report.js";
import { applyCorrectionToConstraints, extractConstraints } from "../src/brief.js";
import { shouldFullRerun, impactForCorrection } from "../src/impact.js";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import type { ControllerState } from "../src/types.js";

function state(question: string, sources: ControllerState["sources"] = []): ControllerState {
  const constraints = extractConstraints(question);
  const brief = {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    originalQuestion: question,
    language: "en",
    attachmentIds: [],
    sourceRestrictions: [],
    nonGoals: [],
    constraints,
    assumptions: [],
    budgetPolicyId: "default",
    consentPolicyVersion: CONSENT_POLICY_VERSION,
    revision: 1,
  };
  return {
    runId: "00000000-0000-4000-8000-000000000003",
    brief,
    basis: { briefRevision: 1, evidenceRevision: 0, consentEpoch: 1, cancellationEpoch: 0, workerLeaseFence: 1 },
    phase: "researching",
    sources,
    passages: [],
    claims: [],
    coverage: [{ id: "q1", question, status: "unstarted" }],
    gaps: [],
    searches: [],
    constraints,
    candidates: [],
    spentMicro: 0,
    budgetMicro: 100_000,
    deleted: false,
    privateCanaries: [],
  };
}

describe("V2-01 / P1 gaps", () => {
  it("names a vendor-matrix gap when only review summaries exist for a compatibility question", () => {
    const s = state("Is NimbusDB compatible with Postgres 14?", [
      {
        id: "1",
        title: "blog",
        locator: "x",
        accessLevel: "full-text",
        sourceType: "review-summary",
      },
    ]);
    const gaps = detectGaps(s);
    expect(gaps.some((g) => g.sourceTypeNeeded === "vendor-matrix")).toBe(true);
  });
});

describe("E03 scope qualifiers", () => {
  it("will not let a 65+ study support an unqualified everyone claim", () => {
    expect(
      passageSupportsClaim(
        "This sample enrolled adults over 65 only. The agent was tolerated in that population.",
        "The agent is safe for everyone.",
      ),
    ).toBe("qualifies");
  });
});

describe("S04 markup", () => {
  it("strips script tags from report text", () => {
    expect(stripUnsafeMarkup("ok <script>alert(1)</script> still")).toBe("ok alert(1) still");
  });
});

describe("R22 calculation", () => {
  it("preserves annual-from-monthly formula", () => {
    const r = calculate("annual_from_monthly", [
      { name: "monthly", value: 40, units: "EUR" },
      { name: "months", value: 12, units: "month" },
    ]);
    expect(r.output).toBe(480);
    expect(r.expression).toContain("40");
    expect(r.expression).toContain("12");
  });
});

describe("V2-04 budget parse", () => {
  it("reads 120 not a trailing 0 from 120 EUR", () => {
    const prev = extractConstraints("Compare options in Germany under 50 EUR as of 2026-03-01");
    const { next, reopenedDiscovery } = applyCorrectionToConstraints(prev, "Actually, the budget is 120 EUR");
    expect(next.find((c) => c.field === "budget")?.value).toBe("120");
    expect(reopenedDiscovery).toBe(true);
  });
});

describe("V2-05 dose correction", () => {
  it("updates dose units without reopening budget discovery", () => {
    const prev = extractConstraints("Give 10 g daily");
    const { next, reopenedDiscovery } = applyCorrectionToConstraints(prev, "Actually the dose is 10 milligrams not 10 grams");
    expect(next.find((c) => c.field === "dose")?.units).toBe("mg");
    expect(reopenedDiscovery).toBe(false);
  });
});

describe("V2-06 unknown dependency fallback", () => {
  it("requires a full rerun when completeness is unknown", () => {
    const impact = impactForCorrection({
      previousConstraints: [],
      nextConstraints: [],
      reopenedDiscovery: false,
      dependencyCompleteness: "unknown",
    });
    expect(shouldFullRerun(impact)).toBe(true);
  });
});

describe("candidate prices", () => {
  it("marks a 90 EUR option as violating a 50 EUR hard cap", () => {
    const found = extractCandidates(
      [
        {
          id: "p1",
          exactText: "Vendor B's lowest SKU in Germany is 90 EUR/month as of 2026-03-01, which exceeds a 50 EUR budget.",
        },
      ],
      [{ id: "budget", field: "budget", operator: "lte", value: "50", units: "EUR", origin: "explicit", importance: "hard", explanation: "x" }],
    );
    expect(found.some((c) => c.feasibility === "violates")).toBe(true);
  });
});
