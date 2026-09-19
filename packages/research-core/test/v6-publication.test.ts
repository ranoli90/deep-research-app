import { describe, expect, it } from "vitest";
import { citationValidationFails, validateMaterialCitations } from "../src/citations.js";
import { passageSupportsClaim } from "../src/support.js";
import { checkReportCitations, withdrawUnverifiableSections } from "../src/report.js";

function input(passage = "Atlas supports offline editing.", claim = passage) {
  return {
    blocks: [{ id: "answer", kind: "text" as const, text: claim, claimIds: ["c1"], citationIds: ["p1"] }],
    claims: [{ id: "c1", text: claim, type: "external-fact", supportStatus: "direct", passageIds: ["p1"] }],
    passages: [{ id: "p1", sourceId: "s1", sourceVersionId: "v1", exactText: passage, locator: "section-1" }],
  };
}

describe("W01 / V6-F01 production citation regressions", () => {
  it("PROBE-01 rejects negated support", () => {
    expect(passageSupportsClaim("Atlas does not support offline editing.", "Atlas supports offline editing.")).toBe("contradicts");
  });
  it("PROBE-02 compares whole numbers including single digits", () => {
    expect(passageSupportsClaim("Atlas costs 90 EUR per month.", "Atlas costs 9 EUR per month.")).toBe("unsupported");
  });
  it.each([
    ["PROBE-03", "Atlas is not offered.", "Atlas offers offline editing."],
    ["PROBE-04", "Atlas is supported only in Germany.", "Atlas is supported in France."],
  ])("%s propagates failure through the report wrapper", (_, passage, claim) => {
    const args = input(passage, claim);
    expect(citationValidationFails(validateMaterialCitations(args))).toBe(true);
    expect(citationValidationFails(checkReportCitations(args.blocks, args.claims, args.passages))).toBe(true);
  });
  it("PROBE-05 rejects unknown claim binding", () => {
    expect(citationValidationFails(validateMaterialCitations({ ...input(), claims: [] }))).toBe(true);
  });
  it("PROBE-06 rejects unmapped material prose", () => {
    const args = input();
    args.blocks[0]!.claimIds = [];
    args.blocks[0]!.text = "Atlas costs 0 EUR and is available worldwide.";
    expect(citationValidationFails(validateMaterialCitations(args))).toBe(true);
  });
  it("rejects an extra unsupported assertion hidden behind one valid claim mapping", () => {
    const args = input();
    args.blocks[0]!.text += " Atlas costs 0 EUR and is available worldwide.";
    expect(citationValidationFails(validateMaterialCitations(args))).toBe(true);
  });
  it("rejects duplicate claim identities with competing texts", () => {
    const args = input();
    args.claims.unshift({ ...args.claims[0]!, text: "Atlas costs 0 EUR." });
    expect(citationValidationFails(validateMaterialCitations(args))).toBe(true);
  });
  it.each(["caveat", "heading"] as const)("material prose cannot hide in an unmapped %s", (kind) => {
    const args = input();
    const blocks = [{ ...args.blocks[0]!, kind, claimIds: [], text: "Atlas costs 0 EUR worldwide." }];
    expect(citationValidationFails(validateMaterialCitations({ ...args, blocks }))).toBe(true);
  });
  it("a claim type label cannot substitute for supporting evidence", () => {
    const args = input();
    args.claims[0]!.type = "limitation";
    args.claims[0]!.passageIds = [];
    expect(citationValidationFails(validateMaterialCitations(args))).toBe(true);
  });
  it("CONTROL-01 accepts direct matching support", () => {
    expect(passageSupportsClaim("Atlas supports offline editing.", "Atlas supports offline editing.")).toBe("supports");
    expect(citationValidationFails(validateMaterialCitations(input()))).toBe(false);
  });
  it("preserves an exact scoped statement and unrelated negative predicate", () => {
    expect(passageSupportsClaim("Atlas is limited to Germany.", "Atlas is limited to Germany.")).toBe("supports");
    expect(passageSupportsClaim("Atlas supports offline editing. Linux is not supported.", "Atlas supports offline editing.")).toBe("supports");
    expect(passageSupportsClaim(
      "This laptop is genuinely capable of running useful local AI, and it's a genuinely pleasant machine to carry around and use every day, which the Raider never claimed to be.",
      "This laptop is genuinely capable of running useful local AI, and it's a genuinely pleasant machine to carry around and use every day.",
    )).toBe("supports");
  });
  it.each([
    ["It is a myth that Atlas supports offline editing.", "Atlas supports offline editing."],
    ["If Atlas supports offline editing, it could replace the desktop client.", "Atlas supports offline editing."],
    ["Atlas acquired Borealis.", "Borealis acquired Atlas."],
    ["Atlas may support offline editing next year.", "Atlas supports offline editing."],
  ])("word overlap is never positive entailment: %s", (passage, claim) => {
    expect(passageSupportsClaim(passage, claim)).not.toBe("supports");
  });
  it("CONTROL-02 rejects unknown passage IDs", () => {
    expect(citationValidationFails(validateMaterialCitations({ ...input(), passages: [] }))).toBe(true);
  });
  it("CONTROL-03 rejects a large numeric mismatch", () => {
    expect(passageSupportsClaim("Atlas costs 90 EUR per month.", "Atlas costs 900 EUR per month.")).toBe("unsupported");
  });
  it("checks ownership on claim-only citations", () => {
    const args = input();
    args.blocks[0]!.citationIds = [];
    expect(citationValidationFails(validateMaterialCitations({ ...args, runPassageIds: new Set() }))).toBe(true);
  });
  it("checks exact source version on claim-only citations", () => {
    const args = input();
    args.blocks[0]!.citationIds = [];
    expect(citationValidationFails(validateMaterialCitations({ ...args, currentVersionBySource: new Map([["s1", "v2"]]) }))).toBe(true);
  });
  it("localizes unsupported draft prose without weakening the publication validator or discarding a valid answer", () => {
    const args = input();
    const blocks: import("@deep/contracts").ReportBlock[] = [...args.blocks,
      { id: "extra", kind: "text", text: "Atlas is free worldwide.", claimIds: [], citationIds: ["p1"] }];
    expect(citationValidationFails(validateMaterialCitations({ ...args, blocks }))).toBe(true);
    const withdrawn = withdrawUnverifiableSections({ constraints: [], sources: [], passages: args.passages }, blocks, args.claims);
    expect(withdrawn).toEqual(["extra"]);
    expect(blocks[0]).toEqual(args.blocks[0]);
    expect(blocks[1]!.text).toMatch(/unresolved/);
    expect(JSON.stringify(blocks)).not.toContain("free worldwide");
    expect(citationValidationFails(validateMaterialCitations({ ...args, blocks }))).toBe(false);
  });
});
