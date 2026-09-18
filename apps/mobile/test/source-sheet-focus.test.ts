import { expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const { focus } = vi.hoisted(() => ({ focus: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()] }));
vi.mock("react-native", () => ({ AccessibilityInfo: { setAccessibilityFocus: focus }, findNodeHandle: (node: unknown) => node ? 12 : null, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
import { SourceSheet } from "../src/SourceSheet";
function tree(node: ReactNode): { type: unknown; props: Record<string, any> }[] {
  if (Array.isArray(node)) return node.flatMap(tree);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [{ type: node.type, props: node.props }, ...tree(node.props.children)];
}
it("focuses the mounted source heading once and preserves the close action", () => {
  focus.mockClear(); const close = vi.fn(); let current = true;
  const nodes = tree(SourceSheet({ source: { passageId: "p", title: "Document", exactText: "Exact passage", accessLevel: "partial-text" }, styles: {} as any, onClose: close, onOpenOriginal: vi.fn(), canFocus: () => current }));
  const heading = nodes.find(n => n.props.accessibilityRole === "header")!;
  heading.props.onLayout(); expect(focus).not.toHaveBeenCalled(); // Not mounted.
  heading.props.ref.current = {}; current = false;
  heading.props.onLayout(); expect(focus).not.toHaveBeenCalled(); // Obsolete account/view.
  current = true; heading.props.onLayout(); heading.props.onLayout();
  expect(focus).toHaveBeenCalledExactlyOnceWith(12);
  nodes.find(n => n.props.accessibilityLabel === "Close source sheet")!.props.onPress(); expect(close).toHaveBeenCalledOnce();
  expect(nodes.some(n => n.props.children === "Exact passage")).toBe(true);
});
