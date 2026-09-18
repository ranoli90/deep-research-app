import { describe, expect, it } from "vitest";
import {
  collapseResearchActivity,
  currentActivityLine,
  labelResearchEvent,
  runningElapsedLabel,
  visibleResearchEvents,
} from "../src/research-activity";

describe("research activity from persisted events", () => {
  it("maps admitted event types to semantic labels and ignores private reasoning", () => {
    expect(labelResearchEvent({ sequence: 1, type: "accepted", publicSummary: "Research accepted." })).toEqual({
      label: "Starting research",
      detail: "Research accepted.",
    });
    expect(labelResearchEvent({ sequence: 1, type: "accepted", publicSummary: "STARTING RESEARCH" })?.detail).toBeNull();
    expect(labelResearchEvent({ sequence: 2, type: "searched", publicSummary: "Searched: laptops under 2000" })?.label).toBe("Searching");
    expect(labelResearchEvent({ sequence: 3, type: "opened_source", publicSummary: "Opened manufacturer spec." })?.label).toBe("Reading a source");
    expect(labelResearchEvent({ sequence: 4, type: "disconfirm_search", publicSummary: "Looked for contrary pricing." })?.label).toBe("Checking a conflicting claim");
    expect(labelResearchEvent({ sequence: 5, type: "writing", publicSummary: "Drafting the report." })?.label).toBe("Writing the report");
    expect(labelResearchEvent({ sequence: 6, type: "chain_of_thought", publicSummary: "Let me think step by step" })).toBeNull();
    expect(labelResearchEvent({ sequence: 7, type: "prompt", publicSummary: "system prompt leaked" })).toBeNull();
    expect(labelResearchEvent({ sequence: 8, type: "mystery", publicSummary: "{\"internal\":true}" })).toBeNull();
  });

  it("does not invent progress when no events exist", () => {
    expect(visibleResearchEvents([])).toEqual([]);
    expect(collapseResearchActivity({ events: [], lifecycle: "running" }).summary).toMatch(/Waiting for the server/);
    expect(collapseResearchActivity({ events: [], lifecycle: "terminal", outcome: "completed" }).summary).toBe("No research activity was recorded.");
    expect(currentActivityLine([])).toMatch(/Waiting for the server/);
  });

  it("collapses to a truthful source count and elapsed time from timestamps", () => {
    const events = [
      { sequence: 1, type: "accepted", publicSummary: "accepted", createdAt: "2026-09-18T12:00:00.000Z" },
      { sequence: 2, type: "opened_source", publicSummary: "a", createdAt: "2026-09-18T12:01:00.000Z" },
      { sequence: 3, type: "opened_source", publicSummary: "b", createdAt: "2026-09-18T12:02:18.000Z" },
      { sequence: 4, type: "writing", publicSummary: "writing", createdAt: "2026-09-18T12:02:18.000Z" },
    ];
    const collapsed = collapseResearchActivity({ events, lifecycle: "terminal", outcome: "completed" });
    expect(collapsed.summary).toBe("Researched 2 sources · 2m 18s");
    expect(collapsed.expandable).toBe(true);
  });

  it("does not claim a source count when none were opened", () => {
    const events = [{ sequence: 1, type: "accepted", publicSummary: "accepted" }];
    expect(collapseResearchActivity({ events, outcome: "completed" }).summary).toBe("Research complete");
    expect(collapseResearchActivity({ events: [...events, { sequence: 2, type: "cancelled", publicSummary: "stopped" }], outcome: "cancelled" }).summary).toBe("Stopped");
  });

  it("shows elapsed time while running from the first recorded event", () => {
    const events = [
      { sequence: 1, type: "accepted", publicSummary: "accepted", createdAt: "2026-09-18T12:00:00.000Z" },
      { sequence: 2, type: "searched", publicSummary: "pricing", createdAt: "2026-09-18T12:00:08.000Z" },
    ];
    expect(runningElapsedLabel(events, Date.parse("2026-09-18T12:00:12.000Z"))).toBe("12s");
    expect(runningElapsedLabel([], Date.now())).toBeNull();
    expect(runningElapsedLabel(events, Date.parse("2026-09-18T11:59:00.000Z"))).toBeNull();
  });

  it("does not call a failed run complete", () => {
    const events = [{ sequence: 1, type: "accepted", publicSummary: "accepted" }];
    expect(collapseResearchActivity({ events, outcome: "failed" }).summary).toBe("Research failed");
  });

  it("does not call a clarification pause complete", () => {
    const events = [{ sequence: 1, type: "clarify", publicSummary: "Which jurisdiction?" }];
    expect(collapseResearchActivity({ events, lifecycle: "awaiting_input" }).summary).toBe("Waiting for a detail");
  });
});
