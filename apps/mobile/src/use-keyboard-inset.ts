import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** Edge-to-edge Android ignores adjustResize; pad from IME frame height. */
export function useKeyboardInset() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardOpenRef = useRef(false);
  const keyboardInsetRef = useRef(0);
  keyboardOpenRef.current = keyboardOpen;
  keyboardInsetRef.current = keyboardInset;

  function applyFrame(height: number) {
    if (height > 0) {
      keyboardOpenRef.current = true;
      keyboardInsetRef.current = height;
      setKeyboardOpen(true);
      setKeyboardInset(height);
      return;
    }
    keyboardOpenRef.current = false;
    keyboardInsetRef.current = 0;
    setKeyboardOpen(false);
    setKeyboardInset(0);
  }

  function dismissKeyboard() {
    applyFrame(0);
    Keyboard.dismiss();
  }

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const changeEvt = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame";
    const show = Keyboard.addListener(showEvt, (e) => applyFrame(e.endCoordinates?.height ?? 0));
    const change = Keyboard.addListener(changeEvt, (e) => applyFrame(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => applyFrame(0));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);

  return { keyboardOpen, keyboardInset, keyboardOpenRef, keyboardInsetRef, dismissKeyboard };
}
