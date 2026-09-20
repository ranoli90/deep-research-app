import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { continueRunRequest } from "../src/pending-input";
import {
  queryAuthorizationApproveBody,
  queryAuthorizationPending,
  readPendingQueryAuthorization,
} from "../src/query-authorization";
import { researchBriefView } from "../src/research-brief";
import { applySnapshot, canSubmit, emptyState } from "../src/state";

const pending = {
  id: "11111111-1111-4111-8111-111111111111",
  proposedQuery: "coral kelp restoration",
  queryDigest: "a".repeat(64),
  briefRevision: 1,
  terms: ["nightfall"],
  reason: "document_search_requires_public_query_approval",
};

describe("query authorization pending UI", () => {
  it("approves only the exact server-issued terms and fails closed when they are missing", () => {
    expect(readPendingQueryAuthorization(null)).toBeNull();
    expect(readPendingQueryAuthorization(pending)).toEqual(pending);
    expect(queryAuthorizationApproveBody(pending)).toEqual({
      authorizationId: pending.id,
      queryDigest: pending.queryDigest,
      terms: ["nightfall"],
    });
    expect(() => queryAuthorizationApproveBody(null)).toThrow(/Exact search terms/);
    expect(() => readPendingQueryAuthorization({ ...pending, terms: ["nightfall", 2] })).toThrow(/will not continue/);
    expect(() => readPendingQueryAuthorization({ ...pending, queryDigest: "short" })).toThrow(/will not continue/);
  });

  it("does not treat stuck query approval as a clarification the user can continue", () => {
    expect(researchBriefView({
      lifecycle: "awaiting_input",
      pendingInputType: "query_authorization",
      clarificationSummary: "Which jurisdiction should this answer apply to?",
      brief: { originalQuestion: "research this company", revision: 1, constraints: [], materialClarification: true },
    }).show).toBe(false);
    expect(() => continueRunRequest({
      pendingInput: { id: pending.id, type: "query_authorization", briefRevision: 1 },
      value: "Texas",
    })).toThrow(/not waiting for a clarification/);
  });

  it("blocks silent public search while approval is pending", () => {
    const run = {
      runId: "592be93e-5060-4410-a802-af2ff6dfebfd",
      lifecycle: "awaiting_input" as const,
      phase: "preparing",
      outcome: null,
      reportId: null,
      labeledDemo: false,
      pendingInput: { id: pending.id, type: "query_authorization" as const, briefRevision: 1 },
      pendingQueryAuthorization: pending,
    };
    expect(queryAuthorizationPending(run)).toBe(true);
    expect(queryAuthorizationPending({ ...run, pendingQueryAuthorization: null, pendingInput: { id: pending.id, type: "clarification" as const, briefRevision: 1, field: "geography" as const } })).toBe(false);
    const state = applySnapshot({ ...emptyState(), signedIn: true, consentGranted: true, draft: "best laptop under 2k" }, run);
    expect(state.run?.pendingQueryAuthorization?.terms).toEqual(["nightfall"]);
    expect(canSubmit(state).ok).toBe(false);
    expect(canSubmit(state).reason).toMatch(/exact search terms/i);
    expect(canSubmit({ ...emptyState(), signedIn: true, consentGranted: true, draft: "best laptop under 2k" }).ok).toBe(true);
    expect(queryAuthorizationPending({ ...run, lifecycle: "terminal", outcome: "cancelled" })).toBe(false);
    expect(queryAuthorizationPending({ ...run, lifecycle: "cancelling" })).toBe(false);
  });

  it("wires approve-exact-terms and keeps the composer closed until approval", () => {
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toContain("queryAuthorizationPending");
    expect(app).toContain("queryAuthorizationApproveBody");
    expect(app).toContain("Approve these search terms");
    expect(app).toContain("pendingInputType: state.run?.pendingInput?.type");
    expect(app).toContain("!queryApprovalPending");
    expect(app).not.toMatch(/terms:\s*pending\.terms\.slice\(0,\s*1\)/);
  });
});
