/** Semantic tokens. Screens consume these; do not copy competitor palettes. */
export const color = {
  light: {
    bg: "#F6F3EE",
    surface: "#FFFDF9",
    ink: "#1C1916",
    muted: "#6B645C",
    line: "#E6DFD4",
    accent: "#255F5A",
    accentMuted: "#D7E8E5",
    danger: "#8B2E2E",
    warning: "#8A5A12",
    success: "#2F6B3A",
    caveat: "#7A4E16",
    /** Docked composer: paper field, teal send square — not a floating pill. */
    composer: {
      fill: "#FFFDF9",
      border: "#E6DFD4",
      ink: "#1C1916",
      placeholder: "#6B645C",
      sendFill: "#255F5A",
      sendInk: "#F6F3EE",
      sendFillDisabled: "#E6DFD4",
      sendInkDisabled: "#6B645C",
    },
    /** Truthful activity rail (not private chain-of-thought). */
    thinking: {
      fill: "#FFFDF9",
      ink: "#6B645C",
      inkActive: "#1C1916",
      rule: "#E6DFD4",
    },
    /** Submitted question — warm stone, not accent wash. */
    userBubble: {
      fill: "#EDE7DD",
      ink: "#1C1916",
    },
    /** Stop — quiet rounded square, not a black circle. */
    stop: {
      fill: "#E6DFD4",
      ink: "#1C1916",
    },
  },
  dark: {
    bg: "#161412",
    surface: "#211E1B",
    ink: "#F4EFE8",
    muted: "#B3AAA0",
    line: "#3A342E",
    accent: "#7EC4BC",
    accentMuted: "#1E3331",
    danger: "#E08A8A",
    warning: "#E0B56A",
    success: "#8FCB98",
    caveat: "#E0B56A",
    /**
     * Dark chrome keeps cream/ink/teal calm contrast.
     * Composer is a warm paper field (not #0F0F0F black clone); send stays teal.
     */
    composer: {
      fill: "#1F1C19",
      border: "#3A342E",
      ink: "#F4EFE8",
      placeholder: "#C6BDB3",
      sendFill: "#7EC4BC",
      sendInk: "#10201E",
      sendFillDisabled: "#2E2924",
      sendInkDisabled: "#8A8278",
    },
    thinking: {
      fill: "#1A1815",
      ink: "#B3AAA0",
      inkActive: "#F4EFE8",
      rule: "#2E2924",
    },
    userBubble: {
      fill: "#2A2622",
      ink: "#F4EFE8",
    },
    stop: {
      fill: "#2E2924",
      ink: "#F4EFE8",
    },
  },
} as const;

export const type = {
  display: { fontSize: 22, lineHeight: 28, fontWeight: "600" as const, letterSpacing: -0.4 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const, letterSpacing: -0.25 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const, letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const, letterSpacing: 0.08 },
  meta: { fontSize: 13, lineHeight: 16, fontWeight: "500" as const, letterSpacing: 0.2 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, gutter: 16, lg: 18, xl: 28 } as const;
export const radius = { sm: 4, md: 8, lg: 12, sheet: 16, composer: 24, pill: 8 } as const;
/**
 * Docked composer optical sizes (kit 14). Visible send is 36 inside a 44 hit.
 * Outer radius 24 is a rounded docked field, not a floating competitor pill.
 */
export const composer = {
  visualHeight: 52,
  radius: 24,
  sendVisible: 36,
  hit: 44,
  attachIcon: 18,
  inputSize: 16,
  inputLineHeight: 22,
  maxLines: 4,
  gutter: 16,
} as const;
/** Durations in ms. Skip decorative motion when reduced-motion is on. */
export const motion = {
  press: 110,
  fast: 140,
  row: 180,
  appear: 200,
  base: 220,
  collapse: 250,
  sheet: 340,
  slow: 360,
  pulse: 900,
} as const;
