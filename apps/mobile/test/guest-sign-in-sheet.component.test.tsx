import { afterEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

vi.mock("react-native", () => {
  class Value { setValue() {} }
  return {
    AccessibilityInfo: { setAccessibilityFocus: () => undefined },
    Animated: { Value, View: "AnimatedView", timing: () => ({ start: () => undefined }), parallel: () => ({ start: () => undefined }) },
    Easing: { out: () => undefined, cubic: () => undefined },
    KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", Platform: { OS: "android" },
    Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
    findNodeHandle: () => null, useWindowDimensions: () => ({ width: 390, height: 800 }),
  };
});
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) }));

import { GuestSignInSheet, type GuestSignInTransport } from "../src/auth/GuestSignInSheet";
import { initialGuestSignInSheetState, type GuestSignInSheetState } from "../src/auth/guest-sign-in-sheet-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const available = { apple: { available: false }, google: { available: false }, email: { available: true } };
const transport: GuestSignInTransport = {
  prepareAttempt: async () => ({ id: "attempt", operation: "email_code", provider: "email", email: "first@example.com" }),
  startProvider: async () => undefined, requestEmailCode: async () => undefined,
  verifyEmailCode: async () => undefined, dismiss: async () => undefined,
};
const state = (email: string): GuestSignInSheetState => ({
  ...initialGuestSignInSheetState(), step: "code", email, provider: "email", retryStep: "code",
});
function sheet(visible: boolean, value: GuestSignInSheetState, override: Partial<GuestSignInTransport> = {}) {
  return <GuestSignInSheet visible={visible} state={value} providers={available}
    onEvent={async () => undefined} onDismiss={() => undefined} onOpenLegalDocument={() => undefined}
    transport={{ ...transport, ...override }} />;
}
afterEach(() => { vi.useRealTimers(); });

it("AUTH-06 keeps the sign-in controls above the native bottom safe area", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(sheet(true, state("first@example.com"))); });
  const panel = renderer.root.find(node => String(node.type) === "AnimatedView");
  expect(panel.props.style.paddingBottom).toBe(36);
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 uses readable dark-mode error ink in the sign-in sheet", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<GuestSignInSheet visible state={{ ...state("first@example.com"), step: "error", error: "Code expired", retryStep: "email" }} providers={available}
    colorScheme="dark" onEvent={async () => undefined} onDismiss={() => undefined} onOpenLegalDocument={() => undefined} transport={transport} />); });
  expect(renderer.root.find(node => String(node.type) === "Text" && node.props.children === "Code expired").props.style.color).toBe("#FFB4AB");
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 never retains an OTP across close/reopen, email change, or a new code challenge", async () => {
  const verify = vi.fn(async () => undefined);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(sheet(true, state("first@example.com"), { verifyEmailCode: verify })); });
  const code = () => renderer.root.findAll(input => String(input.type) === "TextInput").find(input => input.props.accessibilityLabel === "Email verification code")!;
  await act(async () => { code().props.onChangeText("123456"); });
  expect(code().props.value).toBe("123456");
  await act(async () => { renderer.update(sheet(false, state("first@example.com"), { verifyEmailCode: verify })); });
  await act(async () => { renderer.update(sheet(true, state("second@example.com"), { verifyEmailCode: verify })); });
  expect(code().props.value).toBe("");
  await act(async () => { code().props.onChangeText("654321"); });
  await act(async () => { renderer.update(sheet(true, { ...state("second@example.com"), step: "sending_code" }, { verifyEmailCode: verify })); });
  await act(async () => { renderer.update(sheet(true, state("second@example.com"), { verifyEmailCode: verify })); });
  expect(code().props.value).toBe("");
  expect(verify).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 disables resend during cooldown and enables it after the clock advances", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
  const cooldown = { ...state("first@example.com"), resend: { status: "cooldown" as const, retryAt: "2026-09-21T12:00:02.000Z" } };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(sheet(true, cooldown)); });
  const resend = () => renderer.root.findAll(button => String(button.type) === "Pressable").find(button => button.props.accessibilityLabel === "Resend code")!;
  expect(resend().props.disabled).toBe(true);
  await act(async () => { vi.advanceTimersByTime(2100); });
  expect(resend().props.disabled).toBe(false);
  await act(async () => { renderer.unmount(); });
});
