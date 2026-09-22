import { expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { EmptyHome, HOME_STARTERS } from "../src/EmptyHome";

vi.mock("react-native", () => ({
  Pressable: "Pressable", Text: "Text", View: "View",
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles = {
  emptyHero: {}, welcomeDisplay: {}, welcomeSupport: {}, welcomeQuiet: {},
  starterToggle: {}, starterToggleText: {}, starterList: {}, starterRow: {}, starterLabel: {}, starterDescription: {},
};

function texts(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAll((node) => String(node.type) === "Text")
    .map((node) => JSON.stringify(node.props.children)).join(" ");
}

it("composes the Norrow welcome without canned example questions", () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<EmptyHome onPickStarter={() => undefined} typing={false} styles={styles} />); });
  const copy = texts(renderer);
  expect(copy).toContain("Research what");
  expect(copy).toContain("Understand the evidence. See the trade-offs.");
  expect(copy).toContain("Start with a question, a claim, or a decision.");
  expect(copy).toContain("Choose a starting point");
  expect(copy).not.toContain("best laptop");
  expect(copy).not.toContain("should I move to Texas");
  expect(copy).not.toContain("research this company");
  // Starters are hidden behind the disclosure.
  expect(copy).not.toContain("Understand a topic");
});

it("reveals editable starting points that insert a scaffold without sending", () => {
  const onPickStarter = vi.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<EmptyHome onPickStarter={onPickStarter} typing={false} styles={styles} />); });
  const toggle = renderer.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Choose a starting point");
  expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
  act(() => { toggle.props.onPress(); });
  expect(toggle.props.accessibilityState).toMatchObject({ expanded: true });
  expect(texts(renderer)).toContain("Understand a topic");
  for (const starter of HOME_STARTERS) {
    const node = renderer.root.find((n) => String(n.type) === "Pressable" && n.props.accessibilityLabel === starter.label);
    act(() => { node.props.onPress(); });
    expect(onPickStarter).toHaveBeenCalledWith(starter.scaffold);
  }
  expect(onPickStarter).toHaveBeenCalledTimes(HOME_STARTERS.length);
});

it("collapses the starting-point guidance while the user types", () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<EmptyHome onPickStarter={() => undefined} typing={true} styles={styles} />); });
  const copy = texts(renderer);
  expect(copy).toContain("Research what");
  expect(copy).not.toContain("Choose a starting point");
});
