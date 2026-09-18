import { describe, expect, it } from "vitest";
import { readAppearance, resolveAppearance } from "../src/appearance";

describe("appearance preference", () => {
  it("defaults unknown values to system", () => {
    expect(readAppearance(null)).toBe("system");
    expect(readAppearance("weird")).toBe("system");
    expect(readAppearance("dark")).toBe("dark");
  });

  it("resolves system against the device scheme", () => {
    expect(resolveAppearance("system", "dark")).toBe("dark");
    expect(resolveAppearance("system", "light")).toBe("light");
    expect(resolveAppearance("light", "dark")).toBe("light");
    expect(resolveAppearance("dark", "light")).toBe("dark");
  });
});
