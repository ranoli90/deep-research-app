import { describe, expect, it } from "vitest";
import { costToMicro } from "../src/adapters/model/usage.js";

describe("W02 receipt amounts, never reservation-as-spend", () => {
  it.each([[0, 0], [0.000001, 1], ["0.0000011", 2], ["1.25e-5", 13], ["0.25", 250000]])("converts %s USD to %s micro-USD", (raw, expected) => {
    expect(costToMicro(raw)).toBe(expected);
  });
  it.each([undefined, null, "", " ", NaN, Infinity, -1, "-0.1", "1e30"])("keeps invalid/missing %s unknown", (raw) => {
    expect(costToMicro(raw)).toBeUndefined();
  });
});
