import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** Edge-to-edge Android ignores adjustResize; pad from keyboardDidShow height. */
export function useKeyboardInset() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardOpenRef = useRef(false);
  const keyboardInsetRef = useRef(0);
  keyboardOpenRef.current = keyboardOpen;
  keyboardInsetRef.current = keyboardInset;

  function dismissKeyboard() {
    keyboardOpenRef.current = false;
    keyboardInsetRef.current = 0;
    setKeyboardOpen(false);
    setKeyboardInset(0);
    Keyboard.dismiss();
  }

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const height = e.endCoordinates?.height ?? 0;
      keyboardOpenRef.current = true;
      keyboardInsetRef.current = height;
      setKeyboardOpen(true);
      setKeyboardInset(height);
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      keyboardOpenRef.current = false;
      keyboardInsetRef.current = 0;
      setKeyboardOpen(false);
      setKeyboardInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { keyboardOpen, keyboardInset, keyboardOpenRef, keyboardInsetRef, dismissKeyboard };
}
