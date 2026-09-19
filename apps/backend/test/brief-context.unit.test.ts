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
