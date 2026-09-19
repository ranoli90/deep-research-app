import { expect, it } from "vitest";
import { compileCheckedDraft } from "../src/draft-report.js";
import type { DraftStatement } from "../src/draft-assertions.js";
import type { ScopedSupportResult } from "../src/scoped-support.js";

const pid = "11111111-1111-4111-8111-111111111111";
const scope = { entity: "federal", plan: null, version: null, geography: "United States", time: null, population: null };
const assertion = (key: string, text: string): DraftStatement["assertion"] => ({
  key, candidateKey: null, criterionKeys: ["minimum_wage"], text, scope, quantities: [],
  evidence: [{ passageId: pid, start: 0, end: 13, quote: "$7.25 an hour" }],
});
const check = (claimKey: string, decision: ScopedSupportResult["decision"], claimId: string): ScopedSupportResult & { claimId: string } => ({
  claimKey, decision, claimId, modelStatus: "supported", evidence: assertion(claimKey, "x")!.evidence,
  scope, rationale: "test", missingEvidence: [], checks: [], counterEvidence: [],
});

it("keeps a numbered unsupported heading as unresolved rather than an Answer label", () => {
  const heading: DraftStatement = { key: "heading_0", kind: "heading", text: "Restoration improved by 999 percent", premiseKeys: ["current_minimum_wage"], assertion: assertion("heading_0", "Restoration improved by 999 percent") };
  const compiled = compileCheckedDraft([heading], [check("heading_0", "insufficient", "22222222-2222-4222-8222-222222222222")]);
  expect(compiled.blocks[0]).toMatchObject({ kind: "caveat" });
  expect(compiled.unresolved).toEqual(["heading_0"]);
});

it("maps an unsupported heading to Answer so the cited paragraph can publish", () => {
  const heading: DraftStatement = { key: "heading_0", kind: "heading", text: "Current Minimum Wage", premiseKeys: ["current_minimum_wage"], assertion: assertion("heading_0", "Current Minimum Wage") };
  const paragraph: DraftStatement = { key: "paragraph_0_0", kind: "text", text: "The current federal minimum wage is $7.25 an hour.", premiseKeys: ["current_minimum_wage"], assertion: assertion("paragraph_0_0", "The current federal minimum wage is $7.25 an hour.") };
  const compiled = compileCheckedDraft([heading, paragraph], [
    check("heading_0", "insufficient", "22222222-2222-4222-8222-222222222222"),
    check("paragraph_0_0", "supported", "33333333-3333-4333-8333-333333333333"),
  ]);
  expect(compiled.blocks[0]).toMatchObject({ kind: "heading", text: "Answer", claimIds: [], citationIds: [] });
  expect(compiled.blocks[1]).toMatchObject({ kind: "text", text: paragraph.text, citationIds: [pid] });
  expect(compiled.unresolved).toEqual([]);
});

it("does not cite a scope caveat that the wage fragment never stated", () => {
  const heading: DraftStatement = { key: "heading_0", kind: "heading", text: "Answer", premiseKeys: ["current_minimum_wage"], assertion: null };
  const paragraph: DraftStatement = { key: "paragraph_0_0", kind: "text", text: "The current federal minimum wage is $7.25 an hour.", premiseKeys: ["current_minimum_wage"], assertion: assertion("paragraph_0_0", "The current federal minimum wage is $7.25 an hour.") };
  const caveat: DraftStatement = { key: "limitation_0", kind: "caveat", text: "The information provided is based on the current federal minimum wage and does not include state-specific minimum wages or historical changes.", premiseKeys: ["current_minimum_wage"], assertion: assertion("limitation_0", "The information provided is based on the current federal minimum wage and does not include state-specific minimum wages or historical changes.") };
  const compiled = compileCheckedDraft([heading, paragraph, caveat], [
    check("paragraph_0_0", "supported", "33333333-3333-4333-8333-333333333333"),
    check("limitation_0", "supported", "44444444-4444-4444-8444-444444444444"),
  ]);
  expect(compiled.blocks.find((b)=>b.kind==="text")).toMatchObject({ text: paragraph.text, citationIds: [pid] });
  expect(compiled.blocks.find((b)=>b.kind==="caveat")?.text).toMatch(/unresolved/i);
  expect(compiled.unresolved).toEqual(["limitation_0"]);
});
