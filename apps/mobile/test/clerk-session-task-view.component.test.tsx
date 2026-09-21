import { expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

vi.mock("@clerk/expo/native", () => ({ AuthView: "AuthView" }));
vi.mock("react-native", () => ({ Modal: "Modal", Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));

import { ClerkSessionTaskView } from "../src/auth/ClerkSessionTaskView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("PROVIDER-10 native task view keeps a failed close visible and retryable without granting dismissal", async () => {
  let closes = 0;
  const onClose = vi.fn(async () => { if (++closes === 1) throw new Error("unknown server end"); });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<ClerkSessionTaskView visible onClose={onClose} />); });
  expect(renderer.root.find(node => String(node.type) === "AuthView").props.isDismissable).toBe(false);
  const modal = () => renderer.root.find(node => String(node.type) === "Modal");
  const close = () => renderer.root.find(node => String(node.type) === "Pressable");
  await act(async () => { await close().props.onPress(); });
  expect(modal().props.visible).toBe(true);
  expect(renderer.root.findAll(node => String(node.type) === "Text").map(node => String(node.props.children)).join(" ")).toMatch(/Could not confirm sign-in cancellation/);
  expect(close().props.disabled).toBe(false);
  await act(async () => { await close().props.onPress(); });
  expect(onClose).toHaveBeenCalledTimes(2);
  await act(async () => { renderer.unmount(); });
});

it("PROVIDER-10 task wrapper keeps dark-mode heading and safe-area surface", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<ClerkSessionTaskView visible colorScheme="dark" onClose={async () => undefined} />); });
  expect(renderer.root.find(node => String(node.type) === "SafeAreaView").props.style.backgroundColor).toBe("#211F1C");
  expect(renderer.root.find(node => String(node.type) === "Text" && node.props.children === "Complete sign-in").props.style.color).toBe("#F6F2EC");
  await act(async () => { renderer.unmount(); });
});
