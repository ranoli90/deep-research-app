import { describe, expect, it } from "vitest";
import { reconcileDocumentClaim, RECONCILIATION_OUTCOMES } from "../src/reconciliation.js";

const question = "What is the current list price of Zephyr Pro?";
const claim = { key: "c1", text: "Zephyr Pro list price is 40 EUR per month.", date: "2024-01-01" };

describe("document/web reconciliation", () => {
  it("returns each required outcome with source scope and does not summarize the document", () => {
    const confirmed = reconcileDocumentClaim({
      question,
      claim,
      documentText: "Zephyr Pro list price is 40 EUR per month.",
      publicEvidence: [{ sourceId: "s1", accessLevel: "partial-text", text: "Zephyr Pro list price is 40 EUR per month." }],
    });
    expect(confirmed.outcome).toBe("confirmed");
    expect(confirmed.sourceScope.sourceIds).toEqual(["s1"]);
    expect(confirmed.rationale.toLowerCase()).not.toContain("the document says");

    const partial = reconcileDocumentClaim({
      question,
      claim,
      documentText: claim.text,
      publicEvidence: [
        { sourceId: "s1", accessLevel: "partial-text", text: "Zephyr Pro list price is 40 EUR per month." },
        { sourceId: "s2", accessLevel: "partial-text", text: "Zephyr Pro list price is not 40 EUR per month." },
      ],
    });
    expect(partial.outcome).toBe("partially_confirmed");

    const contradicted = reconcileDocumentClaim({
      question,
      claim,
      documentText: claim.text,
      publicEvidence: [{ sourceId: "s2", accessLevel: "partial-text", text: "Zephyr Pro list price is not 40 EUR per month." }],
    });
    expect(contradicted.outcome).toBe("contradicted");

    const outdated = reconcileDocumentClaim({
      question,
      claim,
      documentText: claim.text,
      publicEvidence: [
        { sourceId: "s3", accessLevel: "partial-text", text: "Zephyr Pro list price is 80 EUR per month as of 2026-09-01.", date: "2026-09-01" },
      ],
    });
    expect(outdated.outcome).toBe("outdated");
    expect(
      reconcileDocumentClaim({
        question,
        claim,
        documentText: claim.text,
        publicEvidence: [{ sourceId: "s8", accessLevel: "partial-text", text: "Zephyr Pro list price is 80 EUR per month." }],
      }).outcome,
    ).toBe("contradicted");

    const unverifiable = reconcileDocumentClaim({
      question,
      claim,
      documentText: claim.text,
      publicEvidence: [{ sourceId: "s4", accessLevel: "partial-text", text: "Unrelated coral restoration hectares." }],
    });
    expect(unverifiable.outcome).toBe("unverifiable");

    const blocked = reconcileDocumentClaim({
      question,
      claim,
      documentText: claim.text,
      publicEvidence: [{ sourceId: "s5", accessLevel: "blocked", text: "", blocked: true }],
    });
    expect(blocked.outcome).toBe("blocked_by_access");
    expect(RECONCILIATION_OUTCOMES).toEqual(expect.arrayContaining(["confirmed", "partially_confirmed", "contradicted", "outdated", "unverifiable", "blocked_by_access"]));
  });

  it("requires approval for private-only terms and omits them from the public query", () => {
    const result = reconcileDocumentClaim({
      question: "What is the customer code?",
      claim: { key: "c2", text: "Customer Nightfall budget is 2.4 million." },
      documentText: "Customer Nightfall budget is 2.4 million. CANARY:SECRET99",
      publicEvidence: [],
      privateCanaries: ["CANARY:SECRET99"],
    });
    expect(result.permissionRequired).toBe(true);
    expect(result.queryAuthorization.kind).toBe("permission_required");
    expect(result.queryAuthorization.query).not.toContain("CANARY:SECRET99");
    expect(JSON.stringify(result)).not.toMatch(/CANARY:SECRET99/);
  });
});
