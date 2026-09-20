import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composer, motion } from "@deep/design";

describe("phase B consumer chrome", () => {
  it("keeps composer optical sizes in the 50–56 / 34–38 / 44 hit band", () => {
    expect(composer.visualHeight).toBeGreaterThanOrEqual(50);
    expect(composer.visualHeight).toBeLessThanOrEqual(56);
    expect(composer.sendVisible).toBeGreaterThanOrEqual(34);
    expect(composer.sendVisible).toBeLessThanOrEqual(38);
    expect(composer.hit).toBeGreaterThanOrEqual(44);
    expect(composer.attachIcon).toBeGreaterThanOrEqual(18);
    expect(composer.maxLines).toBe(4);
    const src = readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8");
    expect(src).toContain("Ask anything…");
    expect(src).toContain("ActionGlyph");
    expect(src).toContain("reducedMotion");
  });

  it("drives the research trace from public-activity helpers and honors reduce motion", () => {
    const activity = readFileSync(join(import.meta.dirname, "../src/ResearchActivity.tsx"), "utf8");
    expect(activity).toContain("researchTraceSections");
    expect(activity).toContain("visibleLiveSourcePills");
    expect(activity).toContain("motion.row");
    expect(activity).toContain("motion.collapse");
    expect(activity).toContain("Latest activity");
    expect(activity).not.toMatch(/chain.of.thought|agent persona|Ionicons/i);
    expect(motion.row).toBe(180);
    expect(motion.collapse).toBe(250);
  });

  it("keeps long-report TOC, quote-first evidence, and technical details behind disclosure", () => {
    const report = readFileSync(join(import.meta.dirname, "../src/ReportView.tsx"), "utf8");
    const sheet = readFileSync(join(import.meta.dirname, "../src/SourceSheet.tsx"), "utf8");
    const app = readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8");
    expect(report).toContain("reportNeedsOutline");
    expect(report).toContain("motion.appear");
    expect(app).toContain("reducedMotion={state.reducedMotion}");
    expect(app).toContain("liveActivityFollowsLatest");
    expect(sheet).toContain("Technical details ›");
    expect(sheet).toContain("motion.sheet");
    expect(sheet.indexOf("publisher")).toBeLessThan(sheet.indexOf("source.exactText"));
  });

  it("does not add Reanimated, FlashList, Lucide, or keyboard-controller", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["react-native-reanimated"]).toBeUndefined();
    expect(pkg.dependencies["@shopify/flash-list"]).toBeUndefined();
    expect(pkg.dependencies["lucide-react-native"]).toBeUndefined();
    expect(pkg.dependencies["react-native-keyboard-controller"]).toBeUndefined();
    expect(pkg.dependencies["expo-haptics"]).toBeUndefined();
  });
});
