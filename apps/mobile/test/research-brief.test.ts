import { describe, expect, it } from "vitest";
import { canSubmit, composerFollowsReport, emptyState, startNewResearch } from "../src/state";
import { researchBriefView } from "../src/research-brief";

describe("one-sentence composer and researching-this brief", () => {
  it("lets a natural sentence submit with no attachments", () => {
    const state = { ...emptyState(), signedIn: true, consentGranted: true, draft: "should I move to Texas" };
    expect(state.attachments).toEqual([]);
    expect(canSubmit(state)).toEqual({ ok: true });
  });

  it("skips the brief card when the task can proceed without material flags", () => {
    const view = researchBriefView({
      lifecycle: "running",
      brief: { originalQuestion: "best laptop under 2k", revision: 1, constraints: [] },
    });
    expect(view.show).toBe(false);
    expect(view.blocking).toBe(false);
  });

  it("shows a compact researching-this card from assumed constraints during early phases", () => {
    const view = researchBriefView({
      lifecycle: "queued",
      brief: {
        originalQuestion: "best laptop under 2k for local AI",
        desiredOutcome: "I'll research current laptops under $2,000 for local AI development.",
        revision: 1,
        constraints: [{ field: "geography", value: "US", origin: "assumed" }],
        assumptions: [{ value: "Assuming U.S. pricing and new devices.", reversibility: "reversible", userConfirmationState: "unconfirmed" }],
      },
    });
    expect(view.show).toBe(true);
    expect(view.blocking).toBe(false);
    expect(view.objective).toContain("laptops under $2,000");
    expect(view.assumptions).toContain("Assuming U.S. pricing and new devices.");
  });

  it("still shows a blocking clarification when the run is awaiting input without a stored brief", () => {
    const view = researchBriefView({
      lifecycle: "awaiting_input",
      clarificationSummary: "Which jurisdiction should this answer apply to?",
    });
    expect(view.show).toBe(true);
    expect(view.blocking).toBe(true);
    expect(view.materialClarification).toMatch(/jurisdiction/i);
  });

  it("only blocks on a material clarification when the backend says so", () => {
    const skipped = researchBriefView({
      lifecycle: "queued",
      brief: { originalQuestion: "research this company", revision: 1, constraints: [], materialClarification: false },
    });
    expect(skipped.show).toBe(false);
    const blocked = researchBriefView({
      lifecycle: "awaiting_input",
      clarificationSummary: "Which jurisdiction should this answer apply to?",
      brief: { originalQuestion: "research this company", revision: 1, constraints: [], materialClarification: true },
    });
    expect(blocked.show).toBe(true);
    expect(blocked.blocking).toBe(true);
    expect(blocked.materialClarification).toMatch(/jurisdiction/i);
  });

  it("renders Session A intent-compiler brief fields without graph jargon", () => {
    const view = researchBriefView({
      lifecycle: "queued",
      brief: {
        originalQuestion: "What's the best laptop for running AI locally under $2,000?",
        revision: 1,
        desiredOutcome: "Recommend eligible laptops for local AI under the stated budget.",
        freshnessRequirements: "Prefer current list prices and currently sold configurations.",
        constraints: [{ field: "budget", value: "2000", origin: "explicit", importance: "hard" }],
        assumptions: [{
          value: "“Running AI” means local inference is in scope; cloud-API-only laptops are a documented branch, not a silent replacement.",
          reversibility: "reversible",
          userConfirmationState: "unconfirmed",
          impact: "Changes the hardware search universe.",
        }],
      },
    });
    expect(view.show).toBe(true);
    expect(view.blocking).toBe(false);
    expect(view.objective).toMatch(/local AI/);
    expect(view.assumptions.some((line) => /local inference/i.test(line))).toBe(true);
    expect(view.assumptions.some((line) => /current list prices/i.test(line))).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/criterionIds|traversal|model_policy/i);
  });

  it("does not keep the brief once a report exists", () => {
    expect(researchBriefView({
      hasReport: true,
      lifecycle: "queued",
      brief: { originalQuestion: "q", revision: 1, constraints: [{ field: "budget", value: "2000", origin: "assumed" }] },
    }).show).toBe(false);
  });
});

describe("composer continues a finished report", () => {
  it("treats a completed report as a correction, not a leftover new run", () => {
    const finished = {
      ...emptyState(),
      status: "completed" as const,
      report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true },
      run: {
        runId: "run-1",
        lifecycle: "terminal",
        phase: "done",
        outcome: "completed",
        reportId: "r",
        labeledDemo: true,
      },
    };
    expect(composerFollowsReport(finished)).toBe(true);
    expect(composerFollowsReport({ ...finished, status: "progress", run: { ...finished.run!, lifecycle: "running" } })).toBe(false);
    expect(composerFollowsReport({ ...finished, report: null })).toBe(false);
    expect(composerFollowsReport({ ...finished, pendingContentInvalidation: "gone" })).toBe(false);
    expect(composerFollowsReport({ ...finished, status: "partial" })).toBe(true);
    expect(composerFollowsReport({ ...finished, status: "failed" })).toBe(false);
    expect(composerFollowsReport({
      ...finished,
      pendingAdmission: {
        version: "admission.v1",
        key: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        question: "q",
        routeMode: "fixture",
        uploads: [],
      },
    })).toBe(false);
  });

  it("starts a new research thread without dropping signed-in consent", () => {
    const finished = {
      ...emptyState(),
      signedIn: true,
      consentGranted: true,
      draft: "leftover question",
      status: "completed" as const,
      report: { reportId: "r", blocks: [], limitations: [], labeledDemo: true },
      run: {
        runId: "run-1",
        lifecycle: "terminal",
        phase: "done",
        outcome: "completed",
        reportId: "r",
        labeledDemo: true,
      },
      events: [{ sequence: 1, type: "accepted", publicSummary: "ok" }],
    };
    const result = startNewResearch(finished);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.report).toBeNull();
    expect(result.next.run).toBeNull();
    expect(result.next.draft).toBe("");
    expect(result.next.events).toEqual([]);
    expect(result.next.signedIn).toBe(true);
    expect(result.next.consentGranted).toBe(true);
    expect(result.next.status).toBe("empty");
  });

  it("does not start new research over a pending admission or deletion", () => {
    expect(startNewResearch({
      ...emptyState(),
      pendingAdmission: {
        version: "admission.v1",
        key: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        question: "q",
        routeMode: "fixture",
        uploads: [],
      },
    }).ok).toBe(false);
    expect(startNewResearch({ ...emptyState(), pendingSourceDeletion: "src" }).ok).toBe(false);
  });
});
