import { describe, expect, it } from "vitest";
import { applySnapshot, emptyState, logout, startNewResearch } from "../src/state";
import { redactInvalidatedContent } from "../src/remote-invalidation";
import { bindFollowUpExplain, visibleFollowUpExplain, type FollowUpExplain } from "../src/follow-up-explain";
import { claimIdForReportBlock } from "../src/verification-request";

const explain = (over: Partial<FollowUpExplain> = {}): FollowUpExplain => bindFollowUpExplain({
  accountId: "acct-a",
  runId: "run-a",
  reportId: "report-a",
  question: "Why did you choose that one?",
  answer: "CANARY-ACCOUNT-A",
  evidenceComplete: true,
  citationPassageIds: ["passage-1"],
  ...over,
});

describe("follow-up explanation scope", () => {
  it("keeps server citation passage ids and hides cross-account or cross-report text", () => {
    const bound = bindFollowUpExplain({
      accountId: "acct-a",
      runId: "run-a",
      reportId: "report-a",
      question: "Why?",
      answer: "Because of passage 1.",
      evidenceComplete: true,
      citationPassageIds: ["passage-1", 2, null, "passage-2"],
    });
    expect(bound.citationPassageIds).toEqual(["passage-1", "passage-2"]);
    expect(visibleFollowUpExplain(explain(), { accountId: "acct-b", runId: "run-a", reportId: "report-a" })).toBeNull();
    expect(visibleFollowUpExplain(explain(), { accountId: "acct-a", runId: "run-b", reportId: "report-a" })).toBeNull();
    expect(visibleFollowUpExplain(explain(), { accountId: "acct-a", runId: "run-a", reportId: "report-b" })).toBeNull();
    expect(visibleFollowUpExplain(explain(), { accountId: "acct-a", runId: "run-a", reportId: "report-a" })?.answer).toBe("CANARY-ACCOUNT-A");
  });

  it("clears explanations on logout, new research, report switch, and source invalidation", () => {
    const seeded = { ...emptyState(), signedIn: true, followUpExplain: explain(), run: {
      runId: "run-a", lifecycle: "terminal", phase: "writing", outcome: "completed", reportId: "report-a", labeledDemo: false,
    } };
    expect(logout(seeded).followUpExplain).toBeNull();
    const started = startNewResearch(seeded);
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.next.followUpExplain).toBeNull();
    const switched = applySnapshot(seeded, {
      runId: "run-b", lifecycle: "terminal", phase: "writing", outcome: "completed", reportId: "report-b", labeledDemo: false,
    });
    expect(switched.followUpExplain).toBeNull();
    expect(redactInvalidatedContent(seeded, "run-a").followUpExplain).toBeNull();
  });

  it("transmits the opened non-first conclusion as the verification target", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const blocks = [
      { id: "answer", claimIds: [first] },
      { id: "eligibility", claimIds: [second] },
    ];
    expect(claimIdForReportBlock(blocks, "eligibility")).toBe(second);
    expect(claimIdForReportBlock(blocks, "eligibility")).not.toBe(first);
  });
});
