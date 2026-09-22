import { describe, expect, it } from "vitest";
import { newMemberGrantPolicyOpen, type NewMemberGrantPolicy } from "../src/modules/identity.js";

const now = new Date("2026-09-22T00:00:00Z");
const base: NewMemberGrantPolicy = {
  id: "norrow-new-member-trial.v1",
  enabled: true,
  killed: false,
  expiresAt: new Date("2026-09-23T00:00:00Z"),
  amountMicro: 100_000,
  exposureCapMicro: 1_000_000,
};

describe("R03 pure new-member trial policy gate", () => {
  it("opens only for an enabled, unkilled, unexpired, positive bounded amount", () => {
    expect(newMemberGrantPolicyOpen(base, now)).toBe(true);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["killed", { killed: true }],
    ["expired at the boundary", { expiresAt: new Date(now.getTime()) }],
    ["expired in the past", { expiresAt: new Date(now.getTime() - 1) }],
    ["zero amount", { amountMicro: 0 }],
    ["negative amount", { amountMicro: -1 }],
    ["unsafe amount", { amountMicro: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative cap", { exposureCapMicro: -1 }],
  ] satisfies [string, Partial<NewMemberGrantPolicy>][])("stays closed when %s", (_label, patch) => {
    expect(newMemberGrantPolicyOpen({ ...base, ...patch }, now)).toBe(false);
  });
});
