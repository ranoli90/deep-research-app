import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { keyboardInsetFromFrame } from "./composer-keyboard";

/** Edge-to-edge Android ignores adjustResize; pad from IME frame height. */
export function useKeyboardInset() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardOpenRef = useRef(false);
  const keyboardInsetRef = useRef(0);
  keyboardOpenRef.current = keyboardOpen;
  keyboardInsetRef.current = keyboardInset;

  function applyFrame(kind: "show" | "change" | "hide", height: number) {
    const next = kind === "hide"
      ? { keyboardOpen: false, keyboardHeight: 0 }
      : keyboardInsetFromFrame({ kind, height, platform: Platform.OS });
    keyboardOpenRef.current = next.keyboardOpen;
    keyboardInsetRef.current = next.keyboardHeight;
    setKeyboardOpen(next.keyboardOpen);
    setKeyboardInset(next.keyboardHeight);
  }

  function dismissKeyboard() {
    applyFrame("hide", 0);
    Keyboard.dismiss();
  }

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const changeEvt = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame";
    const show = Keyboard.addListener(showEvt, (e) => applyFrame("show", e.endCoordinates?.height ?? 0));
    const change = Keyboard.addListener(changeEvt, (e) => applyFrame("change", e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => applyFrame("hide", 0));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);

  return { keyboardOpen, keyboardInset, keyboardOpenRef, keyboardInsetRef, dismissKeyboard };
}
