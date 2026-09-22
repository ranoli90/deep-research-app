import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// Cache identity is the stable principal + filter, never the rotating bearer.
const held = vi.hoisted(() => ({ library: vi.fn() }));

vi.mock("../src/api", () => ({
  api: { library: (...args: unknown[]) => held.library(...args) },
  isOfflineError: (error: unknown) => Boolean(error) && (error as { status?: number }).status === 0,
  isSupersededRequest: (error: unknown) => Boolean(error) && (error as { name?: string }).name === "SupersededRequest",
}));

vi.mock("react-native", () => {
  const FlatList = (props: {
    data?: unknown[]; renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor?: (item: unknown) => string; ListHeaderComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode; ListFooterComponent?: React.ReactNode; onEndReached?: () => void;
  }) => React.createElement("FlatList", { onEndReached: props.onEndReached },
    props.ListHeaderComponent ?? null,
    ...(props.data ?? []).map((item, index) => React.createElement(React.Fragment,
      { key: props.keyExtractor ? props.keyExtractor(item) : index }, props.renderItem?.({ item, index }))),
    (props.data ?? []).length === 0 ? (props.ListEmptyComponent ?? null) : null,
    props.ListFooterComponent ?? null);
  return { FlatList, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View" };
});

import { LibraryList, mergeLibraryItems } from "../src/LibraryList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { held.library.mockReset(); });

const styles = {
  body: {}, card: {}, title: {}, kicker: {}, link: {}, quietLink: {}, bodyText: {},
  libraryRow: {}, librarySearch: {}, libraryPreview: {}, libraryMeta: {},
};
const record = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, status: "completed", report_id: `${id}-report`,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", source_count: 2, ...extra,
});
const texts = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" ");
const searchInput = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "TextInput");
const render = (props: Partial<React.ComponentProps<typeof LibraryList>> = {}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<LibraryList token="t1" principal="acct-a" styles={styles}
    onOpen={() => undefined} onShare={() => undefined} {...props} />); });
  return renderer;
};

it("keeps list and filter on same-principal credential renewal and clears them on a real account change", async () => {
  held.library.mockImplementation(async (_token: string, options: { q?: string } = {}) =>
    options.q === "lap"
      ? { items: [record("a", "Laptop research")], nextCursor: null }
      : { items: [record("a", "Laptop research"), record("b", "Phone research")], nextCursor: null });

  const renderer = render();
  await vi.waitFor(() => expect(texts(renderer)).toContain("Phone research"));

  await act(async () => { searchInput(renderer).props.onChangeText("lap"); });
  await vi.waitFor(() => expect(texts(renderer)).not.toContain("Phone research"));
  expect(searchInput(renderer).props.value).toBe("lap");

  // Same principal, new bearer: no blank list, no loading state, filter preserved.
  await act(async () => { renderer.update(<LibraryList token="t2" principal="acct-a" styles={styles}
    onOpen={() => undefined} onShare={() => undefined} />); });
  expect(texts(renderer)).not.toContain("Loading saved reports");
  expect(searchInput(renderer).props.value).toBe("lap");
  expect(texts(renderer)).toContain("Laptop research");
  await vi.waitFor(() => expect(held.library).toHaveBeenCalledWith("t2", { q: "lap" }));

  // A real account change is a protected boundary: old rows and filter are gone.
  held.library.mockResolvedValue({ items: [record("d", "Account B research")], nextCursor: null });
  await act(async () => { renderer.update(<LibraryList token="t3" principal="acct-b" styles={styles}
    onOpen={() => undefined} onShare={() => undefined} />); });
  await vi.waitFor(() => expect(texts(renderer)).toContain("Account B research"));
  expect(texts(renderer)).not.toContain("Laptop research");
  expect(searchInput(renderer).props.value).toBe("");
  await act(async () => { renderer.unmount(); });
});

it("offers an in-place Retry that keeps the query", async () => {
  held.library
    .mockResolvedValueOnce({ items: [record("a", "Laptop research"), record("b", "Phone research")], nextCursor: null })
    .mockRejectedValueOnce({ status: 0 })
    .mockResolvedValueOnce({ items: [record("a", "Laptop research")], nextCursor: null });

  const renderer = render();
  await vi.waitFor(() => expect(texts(renderer)).toContain("Phone research"));

  await act(async () => { searchInput(renderer).props.onChangeText("lap"); });
  await vi.waitFor(() => expect(texts(renderer)).toContain("You're offline."));

  const retry = renderer.root.find((node) =>
    String(node.type) === "Pressable" && node.props.accessibilityLabel === "Retry loading saved reports");
  await act(async () => { retry.props.onPress(); });
  await vi.waitFor(() => expect(texts(renderer)).toContain("Laptop research"));
  expect(texts(renderer)).not.toContain("You're offline.");
  expect(held.library).toHaveBeenLastCalledWith("t1", { q: "lap" });
  await act(async () => { renderer.unmount(); });
});

it("paging during a token refresh never duplicates a row", () => {
  const first = [record("a", "A"), record("b", "B")];
  const second = [record("b", "B"), record("c", "C")];
  expect(mergeLibraryItems(first, second).map((item) => item.id)).toEqual(["a", "b", "c"]);
});

it("removes revision labels from the row and passes the stable principal", () => {
  const list = readFileSync(join(import.meta.dirname, "../src/LibraryList.tsx"), "utf8");
  expect(list).not.toMatch(/\{copy\.version\}/);
  const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
  expect(app).toContain("principal={accountId}");
});
