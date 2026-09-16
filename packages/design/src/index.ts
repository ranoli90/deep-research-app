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
  },
} as const;

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "600" as const },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20 } as const;
