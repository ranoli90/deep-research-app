import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ACTIVITY_LABELS, type PublicActivity, type PublicActivityKind } from "@deep/contracts";
import {
  adoptPublicEvents,
  collapseResearchActivity,
  currentActivityLine,
  displayCollapsedSummary,
  labelResearchEvent,
  liveActivityFollowsLatest,
  researchTraceSections,
  runningElapsedLabel,
  userReleasedLiveFollow,
  visibleResearchEvents,
  type ResearchEvent,
} from "../src/research-activity";

function activity(
  kind: PublicActivityKind,
  extra: Partial<PublicActivity> = {},
): PublicActivity {
  return {
    kind,
    label: extra.label ?? PUBLIC_ACTIVITY_LABELS[kind],
    phase: extra.phase ?? "researching",
    count: extra.count ?? null,
    sourceDomain: extra.sourceDomain ?? null,
    sourceTitle: extra.sourceTitle ?? null,
    createdAt: extra.createdAt ?? "2026-09-18T12:00:00.000Z",
  };
}

function evt(sequence: number, kind: PublicActivityKind | null, extra?: Partial<PublicActivity> & { createdAt?: string }): ResearchEvent {
  return {
    sequence,
    createdAt: extra?.createdAt,
    activity: kind ? activity(kind, extra) : null,
  };
}

describe("research activity from sanitized events", () => {
  it("keeps the elapsed-time clock running when Reduce Motion is on", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/ResearchActivity.tsx"), "utf8");
    expect(src).toMatch(/if \(!inProgress\) return;/);
    expect(src).not.toMatch(/if \(!inProgress \|\| reducedMotion\) return;/);
  });

  it("uses typed activity labels and source metadata, never legacy type/publicSummary", () => {
    expect(labelResearchEvent(evt(1, "intent_ready"))).toEqual({ label: "Understood the question", detail: null });
    expect(labelResearchEvent(evt(2, "searching"))?.label).toBe("Searching public sources");
    expect(labelResearchEvent(evt(3, "source_reading", { sourceTitle: "NIST guidance", sourceDomain: "nist.gov" }))).toEqual({
      label: "Reading a source",
      detail: "NIST guidance · nist.gov",
    });
    expect(labelResearchEvent(evt(4, "writing"))?.label).toBe("Writing the answer");
    expect(labelResearchEvent(evt(5, "report_ready"))?.label).toBe("Answer ready");
    expect(labelResearchEvent(evt(6, null))).toBeNull();
    const visible = visibleResearchEvents([
      evt(3, "source_reading", { sourceTitle: "NIST guidance", sourceDomain: "nist.gov" }),
    ]);
    expect(visible[0]?.sourceTitle).toBe("NIST guidance");
    expect(visible[0]?.sourceDomain).toBe("nist.gov");
  });

  it("never lets a private-looking summary reach UI when activity is the contract", () => {
    const adopted = adoptPublicEvents([
      {
        sequence: 1,
        type: "chain_of_thought",
        publicSummary: "CANARY:PRIVATE_COT let me think step by step",
        payload: { url: "https://intranet.example/raw/secret-path", prompt: "system message" },
        activity: null,
      },
      {
        sequence: 2,
        type: "opened_source",
        publicSummary: "Opened https://intranet.example/raw/secret-path CANARY:RAW_URL",
        activity: activity("source_reading", { sourceDomain: "nist.gov", sourceTitle: "NIST guidance" }),
      },
    ]);
    expect(adopted[0]).toEqual({ sequence: 1, createdAt: undefined, phase: undefined, activity: null });
    expect(adopted[0]).not.toHaveProperty("type");
    expect(adopted[0]).not.toHaveProperty("publicSummary");
    expect(labelResearchEvent(adopted[0]!)).toBeNull();
    expect(currentActivityLine([adopted[0]!])).toBe("Waiting for the server.");
    const visible = visibleResearchEvents(adopted);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.label).toBe("Reading a source");
    expect(visible[0]?.detail).toBe("NIST guidance · nist.gov");
    const ui = JSON.stringify({ headline: currentActivityLine(adopted), visible });
    expect(ui).not.toMatch(/CANARY:PRIVATE_COT|CANARY:RAW_URL|intranet\.example|secret-path|system message|publicSummary/);
    expect(ui).toMatch(/NIST guidance/);
    expect(ui).toMatch(/nist\.gov/);
  });

  it("does not invent progress when no events exist", () => {
    expect(visibleResearchEvents([])).toEqual([]);
    expect(collapseResearchActivity({ events: [], lifecycle: "running" }).summary).toBe("Waiting for the server.");
    expect(collapseResearchActivity({ events: [], lifecycle: "terminal", outcome: "completed" }).summary).toBe("No research activity was recorded.");
    expect(currentActivityLine([])).toBe("Waiting for the server.");
  });

  it("collapses to a truthful source count and elapsed time from timestamps", () => {
    const events = [
      evt(1, "intent_ready", { createdAt: "2026-09-18T12:00:00.000Z", phase: "preparing" }),
      evt(2, "source_reading", { createdAt: "2026-09-18T12:01:00.000Z" }),
      evt(3, "source_reading", { createdAt: "2026-09-18T12:02:18.000Z" }),
      evt(4, "writing", { createdAt: "2026-09-18T12:02:18.000Z", phase: "writing" }),
    ];
    const collapsed = collapseResearchActivity({ events, lifecycle: "terminal", outcome: "completed" });
    expect(collapsed.summary).toBe("Researched 2 sources · 2m 18s ›");
    expect(displayCollapsedSummary(collapsed.summary)).toBe("Researched 2 sources · 2m 18s");
    expect(collapsed.expandable).toBe(true);
    const liveReads = [
      evt(1, "intent_ready", { createdAt: "2026-09-18T12:00:00.000Z" }),
      evt(2, "source_reading", { createdAt: "2026-09-18T12:00:10.000Z" }),
      evt(3, "source_reading", { createdAt: "2026-09-18T12:00:20.000Z" }),
    ];
    expect(collapseResearchActivity({ events: liveReads, outcome: "completed" }).summary).toBe("Researched 2 sources · 20s ›");
  });

  it("does not claim a source count when none were opened", () => {
    const events = [evt(1, "intent_ready")];
    expect(collapseResearchActivity({ events, outcome: "completed" }).summary).toBe("Research complete ›");
    expect(collapseResearchActivity({ events, outcome: "cancelled" }).summary).toBe("Research cancelled ›");
  });

  it("shows elapsed time while running from the first recorded event", () => {
    const events = [
      evt(1, "intent_ready", { createdAt: "2026-09-18T12:00:00.000Z" }),
      evt(2, "searching", { createdAt: "2026-09-18T12:00:08.000Z" }),
    ];
    expect(runningElapsedLabel(events, Date.parse("2026-09-18T12:00:12.000Z"))).toBe("12s");
    expect(runningElapsedLabel([], Date.now())).toBeNull();
    expect(runningElapsedLabel(events, Date.parse("2026-09-18T11:59:00.000Z"))).toBeNull();
  });

  it("does not call a failed run complete", () => {
    const events = [evt(1, "intent_ready")];
    expect(collapseResearchActivity({ events, outcome: "failed" }).summary).toBe("Research failed ›");
  });

  it("does not call a clarification pause complete", () => {
    const events = [evt(1, "clarification")];
    expect(collapseResearchActivity({ events, lifecycle: "awaiting_input" }).summary).toBe("Waiting for a detail ›");
  });

  it("does not repeat consecutive identical consumer labels", () => {
    const visible = visibleResearchEvents([
      evt(1, "intent_ready", { phase: "preparing" }),
      evt(2, "intent_ready", { phase: "preparing", createdAt: "2026-09-18T12:00:01.000Z" }),
      evt(3, "searching", { phase: "researching" }),
      evt(4, "searching", { phase: "researching", createdAt: "2026-09-18T12:00:02.000Z" }),
      evt(5, "source_reading", { phase: "researching", sourceDomain: "nist.gov" }),
    ]);
    expect(visible.map((event) => event.label)).toEqual([
      "Understood the question",
      "Searching public sources",
      "Reading a source",
    ]);
    expect(visible[2]?.sourceDomain).toBe("nist.gov");
  });

  it("groups consecutive real phases without inventing agent personas", () => {
    const sections = researchTraceSections(visibleResearchEvents([
      evt(1, "intent_ready", { phase: "preparing" }),
      evt(2, "searching", { phase: "researching" }),
      evt(3, "source_reading", { phase: "researching", sourceDomain: "nist.gov" }),
      evt(4, "writing", { phase: "writing" }),
    ]));
    expect(sections.map((s) => s.title)).toEqual(["Understanding", "Searching and reading", "Writing"]);
    expect(sections[1]?.events).toHaveLength(2);
    const ui = JSON.stringify(sections);
    expect(ui).not.toMatch(/agent|persona|chain.of.thought/i);
  });

  it("stops following live activity after the user scrolls up", () => {
    expect(liveActivityFollowsLatest({ inProgress: true, hasReport: false, userReleasedFollow: false })).toBe(true);
    expect(liveActivityFollowsLatest({ inProgress: true, hasReport: false, userReleasedFollow: true })).toBe(false);
    expect(liveActivityFollowsLatest({ inProgress: true, hasReport: true, userReleasedFollow: false })).toBe(false);
    expect(userReleasedLiveFollow({ following: true, offsetY: 40, previousOffsetY: 80 })).toBe(true);
    expect(userReleasedLiveFollow({ following: true, offsetY: 90, previousOffsetY: 80 })).toBe(false);
  });

  it("progress UI modules do not treat type or publicSummary as authority", () => {
    for (const file of ["research-activity.ts", "ResearchActivity.tsx"]) {
      const src = readFileSync(join(import.meta.dirname, `../src/${file}`), "utf8");
      expect(src).not.toMatch(/\.publicSummary/);
      expect(src).not.toMatch(/TYPE_LABELS/);
    }
  });
});
