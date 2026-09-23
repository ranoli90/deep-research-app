import { expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

vi.mock("react-native", () => {
  class Value {
    setValue() {}
  }
  return {
    Animated: {
      Value,
      View: "AnimatedView",
      timing: () => ({ start: () => undefined }),
      parallel: () => ({ start: () => undefined }),
      loop: () => ({ start: () => undefined, stop: () => undefined }),
      sequence: () => [],
    },
    Easing: { inOut: () => undefined, out: () => undefined, quad: () => undefined },
    LayoutAnimation: {
      configureNext: () => undefined,
      Types: { easeInEaseOut: "easeInEaseOut" },
      Properties: { opacity: "opacity" },
    },
    Platform: { OS: "android" },
    Pressable: "Pressable",
    Text: "Text",
    UIManager: { setLayoutAnimationEnabledExperimental: () => undefined },
    View: "View",
  };
});
vi.mock("@deep/design", () => ({ motion: { pulse: 1200, row: 120, collapse: 160 } }));
vi.mock("../src/icons", () => ({ ChevronIcon: "ChevronIcon" }));

import { ResearchActivity } from "../src/ResearchActivity";
import type { PublicActivity, PublicActivityKind } from "@deep/contracts";
import type { ResearchEvent } from "../src/research-activity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function activity(kind: PublicActivityKind, extra: Partial<PublicActivity> = {}): PublicActivity {
  const labels: Partial<Record<PublicActivityKind, string>> = {
    source_reading: "Reading a source",
    source_unreadable: "Could not read a source",
    writing: "Writing the answer",
  };
  return {
    kind,
    label: extra.label ?? labels[kind] ?? "Activity",
    phase: extra.phase ?? "researching",
    count: extra.count ?? null,
    sourceDomain: extra.sourceDomain ?? null,
    sourceTitle: extra.sourceTitle ?? null,
    createdAt: extra.createdAt ?? "2026-09-18T12:00:00.000Z",
  };
}

function evt(sequence: number, kind: PublicActivityKind, extra: Partial<PublicActivity> = {}): ResearchEvent {
  return { sequence, createdAt: extra.createdAt, activity: activity(kind, extra) };
}

const styles = new Proxy({}, { get: () => ({}) }) as never;

function render(events: ResearchEvent[], expanded: boolean) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ResearchActivity
        events={events}
        lifecycle="terminal"
        outcome="completed"
        inProgress={false}
        reducedMotion
        expanded={expanded}
        onToggle={() => undefined}
        styles={styles}
      />,
    );
  });
  return renderer;
}

const textOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" | ");

it("mounted Research Trace shows the honest public source context and an unreadable read", () => {
  const events = [
    evt(1, "source_reading", { phase: "researching", sourceTitle: "NIST guidance", sourceDomain: "nist.gov", createdAt: "2026-09-18T12:00:00.000Z" }),
    evt(2, "source_unreadable", { phase: "researching", sourceTitle: "Broken docs", sourceDomain: "broken.example", createdAt: "2026-09-18T12:00:10.000Z" }),
    evt(3, "writing", { phase: "writing", createdAt: "2026-09-18T12:00:20.000Z" }),
  ];
  const renderer = render(events, true);
  const text = textOf(renderer);
  expect(text).toContain("Reading a source");
  expect(text).toContain("NIST guidance · nist.gov");
  expect(text).toContain("Could not read a source");
  expect(text).toContain("Broken docs · broken.example");
  expect(text).toContain("Writing the answer");
  // Collapsed summary counts the successful read only, never the unreadable one.
  expect(textOf(render(events, false))).toContain("Researched 1 source");
});

it("mounted Research Trace keeps a private read generic with no filename or locator", () => {
  const renderer = render([
    evt(1, "source_reading", { phase: "researching", sourceTitle: null, sourceDomain: null }),
    evt(2, "source_unreadable", { phase: "researching", sourceTitle: null, sourceDomain: null }),
  ], true);
  const text = textOf(renderer);
  expect(text).toContain("Reading a source");
  expect(text).toContain("Could not read a source");
  expect(text).not.toMatch(/attachment|Payroll|\.pdf|https?:\/\/|filename/i);
});
