import { space } from "@deep/design";

/** Gboard suggestion strip is often omitted from keyboardDidShow height. */
export const ANDROID_IME_SUGGESTION_INSET = 48;

export function composerDockBottomInset(args: {
  keyboardOpen: boolean;
  keyboardHeight: number;
  safeBottom: number;
  platform: string;
}): number {
  const safeBottom = Math.max(0, args.safeBottom);
  if (!args.keyboardOpen || !(args.keyboardHeight > 0)) {
    return Math.max(safeBottom, space.sm);
  }
  if (args.platform === "ios") return space.xs;
  return args.keyboardHeight + ANDROID_IME_SUGGESTION_INSET;
}

/** Send sits at the top of dock padding; IME+suggestion occupy [0, keyboardHeight+suggestion]. */
export function sendControlClearance(args: {
  keyboardHeight: number;
  dockPadding: number;
  suggestionInset?: number;
}): { sendBottom: number; suggestionTop: number } {
  const suggestion = args.suggestionInset ?? ANDROID_IME_SUGGESTION_INSET;
  return {
    sendBottom: args.dockPadding,
    suggestionTop: args.keyboardHeight + suggestion,
  };
}
