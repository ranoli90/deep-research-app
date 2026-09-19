import { expect, it } from "vitest";
import { briefContext, confirmedConstraints } from "../src/modules/research-tasks.js";
import { modelInputManifest } from "../src/modules/model-operations.js";
import type { Constraint } from "@deep/contracts";

const geo: Constraint = {
  id: "confirmed-geography-germany",
  field: "geography",
  operator: "eq",
  value: "germany",
  origin: "confirmed",
  importance: "hard",
  explanation: "Supplied after clarification",
};

it("briefContext keeps the original question and includes confirmed constraints", () => {
  const question = "What is the filing deadline for employment tax?";
  const context = briefContext(question, confirmedConstraints([geo]));
  expect(context.question).toBe(question);
  expect(context.confirmedConstraints).toEqual([geo]);
  expect(modelInputManifest(context).version).toBe("model-input.v6");
  expect(modelInputManifest(briefContext(question)).version).toBe("model-input.v1");
});

it("ENG-002 planning identity includes semantics but excludes confirmation metadata", () => {
  const brief = {
    id: crypto.randomUUID(), conversationId: crypto.randomUUID(), revision: 1, originalQuestion: "Compare batteries", language:"en",
    attachmentIds:[],sourceRestrictions:[],nonGoals:[],constraints:[],budgetPolicyId:"default",consentPolicyVersion:"test",
    assumptions:[{id:"a",value:"Portable",reversibility:"reversible" as const,impact:"Eligibility",userConfirmationState:"unconfirmed" as const}],
  };
  const base = modelInputManifest(briefContext(brief.originalQuestion,[],brief));
  expect(base.version).toBe("model-input.v7");
  expect(modelInputManifest(briefContext(brief.originalQuestion,[],{...brief,assumptions:[{...brief.assumptions[0]!,userConfirmationState:"accepted"}]}))).toEqual(base);
  expect(modelInputManifest(briefContext(brief.originalQuestion,[],{...brief,sourceRestrictions:["only:official"]}))).not.toEqual(base);
  expect(modelInputManifest(briefContext(brief.originalQuestion,[],{...brief,outputPreferences:"Comparison table"}))).not.toEqual(base);
});
