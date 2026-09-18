import { describe, expect, it } from "vitest";
import { toPublicActivity } from "../src/modules/public-activity.js";

describe("public research activity", () => {
  it("exposes safe labels and never private prompts or document text", () => {
    const ok = toPublicActivity({
      type: "evidence_checked",
      publicSummary: "Checked 3 sources including https://nist.gov/x",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
      payload: { count: 3, title: "NIST guidance" },
    });
    expect(ok).toMatchObject({ kind: "evidence_checked", label: "Checked the evidence", sourceDomain: "nist.gov", count: 3 });
    expect(toPublicActivity({
      type: "searching",
      publicSummary: "prompt: system you are a helpful assistant",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })).toBeNull();
    expect(toPublicActivity({
      type: "writing",
      publicSummary: "attachment://secret CANARY:ABC",
      phase: "writing",
      createdAt: "2026-09-18T00:00:00Z",
    })).toBeNull();
  });
});
