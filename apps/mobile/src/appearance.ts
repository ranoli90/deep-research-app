import type { AppearancePreference } from "./ProfilePanel";

export const APPEARANCE_KEY = "deep.appearance";

export function readAppearance(raw: string | null): AppearancePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemScheme: "light" | "dark" | null | undefined,
): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}
