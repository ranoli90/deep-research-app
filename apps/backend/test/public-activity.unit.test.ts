import { describe, expect, it } from "vitest";
import {
  PUBLIC_ACTIVITY_FALLBACK_PHASE,
  PUBLIC_ACTIVITY_SCHEMA_VERSION,
  SanitizedRunEventSchema,
  publicSourceHostFromText,
  publicSourceUrl,
} from "@deep/contracts";
import { toPublicActivity, toSanitizedRunEvent } from "../src/modules/public-activity.js";
import {
  SOURCE_READ_PUBLIC_VERSION,
  isPublicWebSource,
  readSourceReadPublic,
  sourceReadPublicPayload,
} from "../src/modules/source-read-public.js";

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

  it("clarification activity carries the consumer-safe needed-detail text", () => {
    const asked = toPublicActivity({
      type: "clarify",
      publicSummary: "Which jurisdiction should this answer apply to?",
      phase: "preparing",
      createdAt: "2026-09-18T00:00:00Z",
    });
    expect(asked).toMatchObject({
      kind: "clarification",
      label: "Which jurisdiction should this answer apply to?",
    });
    expect(toPublicActivity({
      type: "clarify",
      publicSummary: "prompt: system message which jurisdiction",
      phase: "preparing",
      createdAt: "2026-09-18T00:00:00Z",
    })).toBeNull();
    expect(toPublicActivity({
      type: "clarify",
      publicSummary: "See https://intranet.example/secret",
      phase: "preparing",
      createdAt: "2026-09-18T00:00:00Z",
    })?.label).toBe("Needed a detail");
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

  it("schema-fail fallback uses the canned phase and never echoes raw phase", () => {
    const rawPhase = `CANARY:UNBOUNDED_PHASE ${"x".repeat(200)}`;
    const failed = toSanitizedRunEvent({
      ...row,
      id: "not-a-uuid",
      type: "writing",
      public_summary: "Writing the answer",
      phase: rawPhase,
    });
    expect(failed.phase).toBe(PUBLIC_ACTIVITY_FALLBACK_PHASE);
    expect(failed.activity).toBeNull();
    expect(JSON.stringify(failed)).not.toContain("CANARY:UNBOUNDED_PHASE");
    expect(JSON.stringify(failed)).not.toContain(rawPhase);
    const unknown = toSanitizedRunEvent({
      ...row,
      type: "writing",
      public_summary: "Writing the answer",
      phase: "CANARY:PHASE",
    });
    expect(unknown.phase).toBe(PUBLIC_ACTIVITY_FALLBACK_PHASE);
    expect(JSON.stringify(unknown)).not.toContain("CANARY:PHASE");
  });

  it("sourceDomain uses publicSourceUrl host rules, omitting RFC1918 and .internal", () => {
    expect(publicSourceUrl("https://nist.gov/x")).toBe("https://nist.gov/x");
    expect(publicSourceUrl("https://10.1.2.3/secret")).toBeNull();
    expect(publicSourceUrl("https://192.168.0.5/x")).toBeNull();
    expect(publicSourceUrl("https://172.16.9.9/x")).toBeNull();
    expect(publicSourceUrl("https://vault.internal/x")).toBeNull();
    expect(publicSourceHostFromText("Opened https://10.1.2.3/secret")).toBeNull();
    expect(publicSourceHostFromText("Opened https://vault.internal/wiki")).toBeNull();
    expect(toPublicActivity({
      type: "opened_source",
      publicSummary: "Opened https://10.1.2.3/secret",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })?.sourceDomain).toBeNull();
    expect(toPublicActivity({
      type: "opened_source",
      publicSummary: "Opened https://vault.internal/wiki",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })?.sourceDomain).toBeNull();
    expect(toPublicActivity({
      type: "opened_source",
      publicSummary: "Opened https://nist.gov/publications/x",
      phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })?.sourceDomain).toBe("nist.gov");
  });
});

describe("source-read-public.v1 contract", () => {
  it("exposes stored public-web title/domain and keeps private supplied documents generic", () => {
    expect(isPublicWebSource({ canonicalLocator: "https://vendor.example/docs", title: "Vendor docs" })).toBe(true);
    expect(isPublicWebSource({ canonicalLocator: "https://10.1.2.3/secret", title: "intranet" })).toBe(false);
    expect(isPublicWebSource({ canonicalLocator: "attachment://abc", title: "payroll.pdf", sourceType: "supplied-document" })).toBe(false);
    expect(isPublicWebSource({ canonicalLocator: "attachment://abc", title: "payroll.pdf" })).toBe(false);

    const read = sourceReadPublicPayload({ canonicalLocator: "https://vendor.example/docs", title: "Vendor docs" }, "read");
    expect(read).toEqual({ version: SOURCE_READ_PUBLIC_VERSION, state: "read", sourceTitle: "Vendor docs", sourceDomain: "vendor.example" });
    const unavailable = sourceReadPublicPayload({ canonicalLocator: "https://vendor.example/docs", title: "Vendor docs" }, "unavailable");
    expect(unavailable).toMatchObject({ state: "unavailable", sourceTitle: "Vendor docs", sourceDomain: "vendor.example" });
    const privateDoc = sourceReadPublicPayload(
      { canonicalLocator: "attachment://abc", title: "Payroll 2026.pdf", sourceType: "supplied-document" }, "read");
    expect(privateDoc).toMatchObject({ state: "read", sourceTitle: null, sourceDomain: null });
    expect(JSON.stringify(privateDoc)).not.toMatch(/Payroll|attachment|abc/);
    // A public title that is itself a URL or private marker is dropped; the domain is still honest.
    expect(sourceReadPublicPayload({ canonicalLocator: "https://vendor.example/docs", title: "https://intranet.example/secret" }, "read"))
      .toMatchObject({ sourceTitle: null, sourceDomain: "vendor.example" });
    expect(sourceReadPublicPayload({ canonicalLocator: "https://vendor.example/docs", title: "prompt: system message" }, "read"))
      .toMatchObject({ sourceTitle: null, sourceDomain: "vendor.example" });
  });

  it("reads the versioned payload back and refuses legacy or malformed payloads", () => {
    expect(readSourceReadPublic({ sourceRead: { version: SOURCE_READ_PUBLIC_VERSION, state: "read", sourceTitle: "A", sourceDomain: "a.com" } }))
      .toMatchObject({ state: "read" });
    expect(readSourceReadPublic({ outcome: "successful_body", sourceHandle: "x" })).toBeNull();
    expect(readSourceReadPublic({ sourceRead: { version: "source-read-public.v0", state: "read", sourceTitle: null, sourceDomain: null } })).toBeNull();
    expect(readSourceReadPublic({ sourceRead: { version: SOURCE_READ_PUBLIC_VERSION, state: "nonsense", sourceTitle: null, sourceDomain: null } })).toBeNull();
    expect(readSourceReadPublic(null)).toBeNull();
  });

  it("maps the honest versioned state to the consumer kind and never a failed read to success", () => {
    const publicRead = { sourceRead: sourceReadPublicPayload({ canonicalLocator: "https://nist.gov/x", title: "NIST guidance" }, "read") };
    expect(toPublicActivity({ type: "source_read", publicSummary: "Source reading finished.", phase: "researching", createdAt: "2026-09-18T00:00:00Z", payload: publicRead }))
      .toMatchObject({ kind: "source_reading", label: "Reading a source", sourceTitle: "NIST guidance", sourceDomain: "nist.gov" });

    const unavailable = { sourceRead: sourceReadPublicPayload({ canonicalLocator: "https://nist.gov/x", title: "NIST guidance" }, "unavailable") };
    expect(toPublicActivity({ type: "source_read", publicSummary: "The source could not provide readable evidence.", phase: "researching", createdAt: "2026-09-18T00:00:00Z", payload: unavailable }))
      .toMatchObject({ kind: "source_unreadable", label: "Could not read a source", sourceTitle: "NIST guidance", sourceDomain: "nist.gov" });

    const privateDoc = { sourceRead: sourceReadPublicPayload({ canonicalLocator: "attachment://abc", title: "Payroll 2026.pdf", sourceType: "supplied-document" }, "read") };
    const privateActivity = toPublicActivity({ type: "source_read", publicSummary: "Source reading finished.", phase: "researching", createdAt: "2026-09-18T00:00:00Z", payload: privateDoc });
    expect(privateActivity).toMatchObject({ kind: "source_reading", sourceTitle: null, sourceDomain: null });
    expect(JSON.stringify(privateActivity)).not.toMatch(/Payroll|attachment|abc/);

    // A validated public domain is honest context even if its text trips the raw private-marker regex.
    expect(toPublicActivity({
      type: "source_read", publicSummary: "Source reading finished.", phase: "researching", createdAt: "2026-09-18T00:00:00Z",
      payload: { sourceRead: { version: SOURCE_READ_PUBLIC_VERSION, state: "read", sourceTitle: null, sourceDomain: "password-reset.example.com" } },
    })).toMatchObject({ kind: "source_reading", sourceDomain: "password-reset.example.com" });
  });

  it("keeps legacy source_read readers honest and invents no source for old events", () => {
    // No versioned payload and no source id: state and identity stay unknown, never a fabricated source.
    const legacyUnknown = toPublicActivity({ type: "source_read", publicSummary: "Source reading finished.", phase: "researching", createdAt: "2026-09-18T00:00:00Z" });
    expect(legacyUnknown).toMatchObject({ kind: "source_reading", sourceTitle: null, sourceDomain: null });
    expect(toPublicActivity({
      type: "source_read", publicSummary: "The source could not provide readable evidence.", phase: "researching",
      createdAt: "2026-09-18T00:00:00Z", payload: { operationId: "11111111-1111-4111-8111-111111111111", sourceHandle: "22222222-2222-4222-8222-222222222222", outcome: "unavailable_status" },
    })).toMatchObject({ kind: "source_unreadable", sourceTitle: null, sourceDomain: null });
    expect(toPublicActivity({
      type: "source_read", publicSummary: "Source reading finished.", phase: "researching",
      createdAt: "2026-09-18T00:00:00Z", payload: { outcome: "successful_body" },
    })).toMatchObject({ kind: "source_reading" });
    // Legacy opened_source keeps deriving the public host from summary text only.
    expect(toPublicActivity({
      type: "opened_source", publicSummary: "Opened https://nist.gov/publications/x", phase: "researching",
      createdAt: "2026-09-18T00:00:00Z",
    })).toMatchObject({ kind: "source_reading", sourceDomain: "nist.gov", sourceTitle: null });
  });
});

