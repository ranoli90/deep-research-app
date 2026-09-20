import { space } from "@deep/design";

/** Gboard suggestion strip is often omitted from keyboardDidShow height. */
export const ANDROID_IME_SUGGESTION_INSET = 48;

export type KeyboardFrameKind = "show" | "change" | "hide";

/** Map RN keyboard events to dock inset. Android adjustResize can report height 0 while the IME is up. */
export function keyboardInsetFromFrame(args: {
  kind: KeyboardFrameKind;
  height: number;
  platform: string;
}): { keyboardOpen: boolean; keyboardHeight: number } {
  if (args.kind === "hide") return { keyboardOpen: false, keyboardHeight: 0 };
  const height = Number.isFinite(args.height) ? Math.max(0, args.height) : 0;
  if (height > 0) return { keyboardOpen: true, keyboardHeight: height };
  if (args.platform === "android") return { keyboardOpen: true, keyboardHeight: 0 };
  return { keyboardOpen: false, keyboardHeight: 0 };
}

export function composerDockBottomInset(args: {
  keyboardOpen: boolean;
  keyboardHeight: number;
  safeBottom: number;
  platform: string;
}): number {
  const safeBottom = Math.max(0, args.safeBottom);
  if (args.platform === "ios") {
    return args.keyboardOpen ? space.xs : Math.max(safeBottom, space.sm);
  }
  if (!args.keyboardOpen) return Math.max(safeBottom, space.sm);
  // Window already resized to the IME body; still clear the suggestion strip so Send/Stop stay tappable.
  if (!(args.keyboardHeight > 0)) {
    return Math.max(safeBottom, space.sm) + ANDROID_IME_SUGGESTION_INSET;
  }
  return args.keyboardHeight + ANDROID_IME_SUGGESTION_INSET;
}

/** Send and Stop share the dock row above padding; IME+suggestion occupy [0, keyboardHeight+suggestion]. */
export function sendControlClearance(args: {
  keyboardHeight: number;
  dockPadding: number;
  suggestionInset?: number;
}): { sendBottom: number; stopBottom: number; suggestionTop: number } {
  const suggestion = args.suggestionInset ?? ANDROID_IME_SUGGESTION_INSET;
  return {
    sendBottom: args.dockPadding,
    stopBottom: args.dockPadding,
    suggestionTop: args.keyboardHeight + suggestion,
  };
}
