import { describe, expect, it } from "vitest";
import { PUBLIC_ACTIVITY_SCHEMA_VERSION, SanitizedRunEventSchema } from "@deep/contracts";
import { toPublicActivity, toSanitizedRunEvent } from "../src/modules/public-activity.js";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  sequence: 3,
  phase: "researching",
  created_at: "2026-09-18T00:00:00.000Z",
};

describe("public research activity", () => {
  it("exposes safe labels and never private prompts or document text", () => {
    const ok = toPublicActivity({
      type: "evidence_checked",
      publicSummary: "Checked 3 sources including https://nist.gov/x",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
      payload: { count: 3, title: "NIST guidance" },
    });
    expect(ok).toMatchObject({ kind: "evidence_checked", label: "Checked the evidence", sourceDomain: "nist.gov", count: 3, sourceTitle: "NIST guidance" });
    expect(toPublicActivity({
      type: "source_read",
      publicSummary: "Source reading finished.",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })?.kind).toBe("source_reading");
    expect(toPublicActivity({
      type: "intent_compiled",
      publicSummary: "Understood the question.",
      phase: "preparing",
      createdAt: "2026-09-18T00:00:00Z",
    })?.kind).toBe("intent_ready");
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

  it("omits CoT, private canaries, raw summaries, and URL payloads from the consumer DTO", () => {
    const cot = toSanitizedRunEvent({
      ...row,
      type: "chain_of_thought",
      public_summary: "CANARY:PRIVATE_COT let me think step by step",
      payload: { url: "https://intranet.example/raw/secret-path", prompt: "system message" },
    });
    expect(cot.schemaVersion).toBe(PUBLIC_ACTIVITY_SCHEMA_VERSION);
    expect(cot.activity).toBeNull();
    const cotJson = JSON.stringify(cot);
    expect(cotJson).not.toMatch(/CANARY:PRIVATE_COT|intranet\.example|secret-path|system message|publicSummary|public_summary|"type"|chain_of_thought/);
    expect(cot).not.toHaveProperty("type");
    expect(cot).not.toHaveProperty("publicSummary");
    expect(cot).not.toHaveProperty("payload");
    expect(SanitizedRunEventSchema.parse(cot).activity).toBeNull();

    const leakedSearch = toSanitizedRunEvent({
      ...row,
      sequence: 4,
      type: "opened_source",
      public_summary: "Opened https://docs.python.org/3/library/sqlite3.html CANARY:RAW_URL",
      payload: { title: "https://intranet.example/raw/title", url: "https://intranet.example/raw/secret-path" },
    });
    expect(leakedSearch.activity).toMatchObject({ kind: "source_reading", sourceDomain: "docs.python.org", sourceTitle: null });
    expect(JSON.stringify(leakedSearch)).not.toMatch(/CANARY:RAW_URL|intranet\.example|secret-path|publicSummary|docs\.python\.org\/3/);

    const safe = toSanitizedRunEvent({
      ...row,
      sequence: 5,
      type: "opened_source",
      public_summary: "Opened https://nist.gov/publications/x",
      payload: { title: "NIST guidance", count: 1 },
    });
    expect(SanitizedRunEventSchema.parse(safe).activity).toMatchObject({
      kind: "source_reading",
      sourceDomain: "nist.gov",
      sourceTitle: "NIST guidance",
      count: 1,
    });
    expect(JSON.stringify(safe)).not.toMatch(/nist\.gov\/publications|publicSummary|"type"|payload/);
  });
});
