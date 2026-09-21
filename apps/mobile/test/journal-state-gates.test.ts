import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preparePendingFollowUp, type PendingFollowUp } from "../src/follow-up-admission";
import { preparePendingAssumptions, type PendingAssumptions } from "../src/pending-input";
import { preparePendingCorrection, type PendingCorrection } from "../src/correction-draft";
import { androidBack, canSubmit, emptyState, startNewResearch, type UiState } from "../src/state";

const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const phases = ["adopted", "rejected", "withdrawn"] as const;
type TerminalPhase = (typeof phases)[number];
type JournalField = "pendingFollowUp" | "pendingAssumptions" | "pendingCorrection";
type DurableJournal = PendingFollowUp | PendingAssumptions | PendingCorrection;

function terminalFollowUp(phase: TerminalPhase): PendingFollowUp {
  const prepared = preparePendingFollowUp({
    parentRunId,
    message: "Investigate battery life",
    expectedBriefRevision: 3,
    requestId,
  });
  return phase === "adopted"
    ? { ...prepared, phase, acceptedRunId: childRunId, acceptedBriefRevision: 4 }
    : { ...prepared, phase };
}

function terminalAssumptions(phase: TerminalPhase): PendingAssumptions {
  const prepared = preparePendingAssumptions({
    parentRunId,
    action: "replace",
    values: ["Quiet fans"],
    expectedBriefRevision: 3,
    requestId,
  });
  return phase === "adopted"
    ? { ...prepared, phase, acceptedRunId: childRunId, acceptedBriefRevision: 4 }
    : { ...prepared, phase };
}

function terminalCorrection(phase: TerminalPhase): PendingCorrection {
  const prepared = preparePendingCorrection({
    parentRunId,
    question: "Which laptop has the longest battery life?",
    expectedBriefRevision: 3,
    evidencePolicy: "refresh",
    requestId,
  });
  return phase === "adopted"
    ? { ...prepared, phase, acceptedRunId: childRunId, acceptedBriefRevision: 4 }
    : { ...prepared, phase };
}

const terminalCases = phases.flatMap((phase) => [
  { name: `follow-up ${phase}`, field: "pendingFollowUp" as const, journal: terminalFollowUp(phase) },
  { name: `assumption ${phase}`, field: "pendingAssumptions" as const, journal: terminalAssumptions(phase) },
  { name: `correction ${phase}`, field: "pendingCorrection" as const, journal: terminalCorrection(phase) },
]);

function stateWith(field: JournalField, journal: DurableJournal): UiState {
  return {
    ...emptyState(),
    signedIn: true,
    consentGranted: true,
    draft: "Start an unrelated question",
    run: {
      runId: parentRunId,
      lifecycle: "terminal",
      phase: "done",
      outcome: "completed",
      reportId: null,
      labeledDemo: true,
    },
    [field]: journal,
  };
}

describe("RES-04 strict durable-journal state gates", () => {
  it.each(terminalCases)("holds damaged $name across submit, new-research, and Android-back gates", ({ field, journal }) => {
    const damaged = { ...journal, payloadDigest: "f".repeat(64) } as DurableJournal;
    const state = stateWith(field, damaged);

    expect(canSubmit(state)).toMatchObject({ ok: false, reason: expect.stringMatching(/Device cleanup/) });
    expect(state[field]).toBe(damaged);

    expect(startNewResearch(state)).toMatchObject({ ok: false, reason: expect.stringMatching(/Device cleanup/) });
    expect(state[field]).toBe(damaged);

    const backed = androidBack(state);
    expect(backed.consumed).toBe(true);
    expect(backed.next[field]).toBe(damaged);
    expect(backed.next.run).toBe(state.run);
    expect(backed.next.error).toMatch(/Device cleanup/);
  });

  it.each(terminalCases)("allows valid $name through all state gates", ({ field, journal }) => {
    const state = stateWith(field, journal);
    expect(canSubmit(state)).toEqual({ ok: true });

    const started = startNewResearch(state);
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.next[field]).toBeNull();

    const backed = androidBack(state);
    expect(backed.next.run).toBeNull();
    expect(backed.next[field]).toBeNull();
  });

  it.each([
    { field: "pendingAssumptions" as const, journal: terminalAssumptions("rejected") },
    { field: "pendingCorrection" as const, journal: terminalCorrection("withdrawn") },
  ])("does not let an earlier unresolved journal conceal damaged $field", ({ field, journal }) => {
    const pendingFollowUp = preparePendingFollowUp({
      parentRunId,
      message: "Finish the saved follow-up",
      expectedBriefRevision: 3,
      requestId,
    });
    const damaged = { ...journal, payloadDigest: "f".repeat(64) } as DurableJournal;
    const state = { ...stateWith(field, damaged), pendingFollowUp };
    expect(canSubmit(state).reason).toMatch(/Device cleanup/);
    expect(startNewResearch(state)).toMatchObject({ ok: false, reason: expect.stringMatching(/Device cleanup/) });
    expect(state.pendingFollowUp).toBe(pendingFollowUp);
    expect(state[field]).toBe(damaged);
  });

  it("keeps every production App admission, New Research, routed follow-up, and Android-back path behind the state gates", () => {
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    const send = app.slice(app.indexOf("async function onSend()"), app.indexOf("async function adoptAdmission("));
    expect(send.indexOf("const gate = canSubmit(")).toBeGreaterThanOrEqual(0);
    expect(send.indexOf("const gate = canSubmit(")).toBeLessThan(send.indexOf("prepareAdmission("));
    const newResearch = app.slice(app.indexOf("function onNewResearch()"), app.indexOf("async function onContinueClarification()"));
    expect(newResearch.indexOf("const result = startNewResearch(latestUi.current);")).toBeGreaterThanOrEqual(0);
    expect(newResearch.indexOf("const result = startNewResearch(latestUi.current);")).toBeLessThan(newResearch.indexOf("api.selectRun(null)"));
    const routedFollowUp = app.slice(app.indexOf("async function onComposerFollowUp("), app.indexOf("async function onFollowUp("));
    expect(routedFollowUp.indexOf("const started = startNewResearch({ ...current, attachments: [] });")).toBeGreaterThanOrEqual(0);
    expect(routedFollowUp.indexOf("const started = startNewResearch({ ...current, attachments: [] });")).toBeLessThan(routedFollowUp.indexOf("void onSend()"));
    expect(app).toContain("const r = androidBack(latestUi.current);");
  });
});
