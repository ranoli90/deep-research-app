import { Platform, Vibration } from "react-native";

/** Optional enhancement. State must remain understandable with haptics off. */
export type ProductHaptic = "send" | "stop" | "complete" | "warn";

const DURATION_MS: Record<ProductHaptic, number> = {
  send: 8,
  stop: 16,
  complete: 18,
  warn: 32,
};

export function productHaptic(kind: ProductHaptic): void {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  try {
    Vibration.vibrate(DURATION_MS[kind]);
  } catch {
    /* Haptics are never required to understand state. */
  }
}
