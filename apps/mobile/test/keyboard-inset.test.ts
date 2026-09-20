import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANDROID_IME_SUGGESTION_INSET, composerDockBottomInset, keyboardInsetFromFrame, sendControlClearance } from "../src/composer-keyboard";

describe("composer keyboard inset", () => {
  it("keeps Send and Stop above the Android IME including the suggestion bar", () => {
    const keyboardHeight = 320;
    const padding = composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight,
      safeBottom: 48,
      platform: "android",
    });
    const { sendBottom, stopBottom, suggestionTop } = sendControlClearance({ keyboardHeight, dockPadding: padding });
    expect(padding).toBe(keyboardHeight + ANDROID_IME_SUGGESTION_INSET);
    expect(sendBottom).toBeGreaterThanOrEqual(suggestionTop);
    expect(stopBottom).toBe(sendBottom);
    expect(sendBottom).toBeGreaterThan(keyboardHeight);
  });

  it("still clears the Gboard suggestion strip after adjustResize reports height 0", () => {
    const padding = composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight: 0,
      safeBottom: 24,
      platform: "android",
    });
    const { sendBottom, stopBottom, suggestionTop } = sendControlClearance({ keyboardHeight: 0, dockPadding: padding });
    expect(padding).toBe(24 + ANDROID_IME_SUGGESTION_INSET);
    expect(sendBottom).toBeGreaterThanOrEqual(suggestionTop);
    expect(stopBottom).toBeGreaterThanOrEqual(suggestionTop);
    expect(composerDockBottomInset({
      keyboardOpen: false,
      keyboardHeight: 0,
      safeBottom: 24,
      platform: "android",
    })).toBe(24);
  });

  it("does not use the closed-keyboard safe-area gap while the IME is open on Android", () => {
    const open = composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight: 280,
      safeBottom: 48,
      platform: "android",
    });
    const closed = composerDockBottomInset({
      keyboardOpen: false,
      keyboardHeight: 0,
      safeBottom: 48,
      platform: "android",
    });
    expect(open).toBeGreaterThan(closed);
    expect(closed).toBe(48);
  });

  it("lets iOS KeyboardAvoidingView own the IME offset", () => {
    expect(composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight: 336,
      safeBottom: 34,
      platform: "ios",
    })).toBe(4);
  });

  it("keeps Android IME open when a change frame reports height 0 after resize", () => {
    expect(keyboardInsetFromFrame({ kind: "show", height: 320, platform: "android" })).toEqual({
      keyboardOpen: true, keyboardHeight: 320,
    });
    expect(keyboardInsetFromFrame({ kind: "change", height: 0, platform: "android" })).toEqual({
      keyboardOpen: true, keyboardHeight: 0,
    });
    expect(keyboardInsetFromFrame({ kind: "hide", height: 0, platform: "android" })).toEqual({
      keyboardOpen: false, keyboardHeight: 0,
    });
  });

  it("does not shrink dock padding when large text grows the composer field", () => {
    const padding = composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight: 300,
      safeBottom: 16,
      platform: "android",
    });
    const doubledField = 52 * 2;
    const { sendBottom, suggestionTop } = sendControlClearance({ keyboardHeight: 300, dockPadding: padding });
    expect(sendBottom).toBeGreaterThanOrEqual(suggestionTop);
    expect(padding).toBe(300 + ANDROID_IME_SUGGESTION_INSET);
    expect(doubledField).toBeGreaterThan(0);
    const src = [
      readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8"),
      readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8"),
    ].join("\n");
    expect(src).toContain("composerDockBottomInset");
    expect(src).toContain("keyboardInset");
    expect(src).toContain("stopBesideSend");
    expect(src).toContain("maxFontSizeMultiplier={2}");
  });
});
