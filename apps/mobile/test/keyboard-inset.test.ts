import { describe, expect, it } from "vitest";
import { ANDROID_IME_SUGGESTION_INSET, composerDockBottomInset, sendControlClearance } from "../src/composer-keyboard";

describe("composer keyboard inset", () => {
  it("keeps the send control above the Android IME including the suggestion bar", () => {
    const keyboardHeight = 320;
    const padding = composerDockBottomInset({
      keyboardOpen: true,
      keyboardHeight,
      safeBottom: 48,
      platform: "android",
    });
    const { sendBottom, suggestionTop } = sendControlClearance({ keyboardHeight, dockPadding: padding });
    expect(padding).toBe(keyboardHeight + ANDROID_IME_SUGGESTION_INSET);
    expect(sendBottom).toBeGreaterThanOrEqual(suggestionTop);
    expect(sendBottom).toBeGreaterThan(keyboardHeight);
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
});
