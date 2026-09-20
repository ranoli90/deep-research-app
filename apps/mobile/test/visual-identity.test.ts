import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { color, composer as composerMetrics, motion, radius, type as typeTokens } from "@deep/design";

describe("original visual identity", () => {
  it("keeps compact editorial type and non-pill radius", () => {
    expect(typeTokens.display.fontSize).toBeLessThanOrEqual(20);
    expect(typeTokens.body.fontSize).toBe(16);
    expect(typeTokens.title.fontSize).toBe(18);
    expect(typeTokens.body.lineHeight).toBe(24);
    expect(radius.pill).toBeLessThanOrEqual(12);
    expect(radius.composer).toBe(24);
    expect(motion.pulse).toBe(900);
    expect(motion.collapse).toBe(250);
    expect(motion.sheet).toBe(340);
    expect(color.dark.composer.fill).not.toBe("#0F0F0F");
  });

  it("composer uses a docked field, 36px send, and 44px invisible hits", () => {
    const styles = readFileSync(join(import.meta.dirname, "../src/product-styles.ts"), "utf8");
    const composer = readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8");
    expect(composerMetrics.visualHeight).toBe(52);
    expect(composerMetrics.sendVisible).toBe(36);
    expect(composerMetrics.hit).toBe(44);
    expect(composerMetrics.attachIcon).toBe(18);
    expect(composerMetrics.maxLines).toBe(4);
    expect(styles).toContain("composerMetrics.inputLineHeight * composerMetrics.maxLines");
    expect(styles).toContain("borderTopWidth: StyleSheet.hairlineWidth");
    expect(styles).toContain("sendHit");
    expect(styles).toContain("composerMetrics.sendVisible");
    expect(styles).not.toMatch(/composerWrap:.*borderRadius: radius\.pill/);
    expect(composer).toContain("PlusIcon");
    expect(composer).toContain("ArrowUpIcon");
    expect(composer).toContain("StopIcon");
    expect(composer).toContain("productHaptic");
    expect(composer).toContain("sendHit");
    expect(composer).not.toContain("@expo/vector-icons");
    expect(styles).toMatch(/librarySearch:\s*\{[^}]*borderRadius: radius\.md/);
    expect(styles).not.toMatch(/librarySearch:\s*\{[^}]*borderBottomWidth/);
  });

  it("activity uses an event rail and citations are not teal pills", () => {
    const activity = readFileSync(join(import.meta.dirname, "../src/ResearchActivity.tsx"), "utf8");
    const report = readFileSync(join(import.meta.dirname, "../src/ReportView.tsx"), "utf8");
    const styles = readFileSync(join(import.meta.dirname, "../src/product-styles.ts"), "utf8");
    expect(activity).toContain("activityRail");
    expect(activity).toContain("liveSourcePillsFromEvents");
    expect(report).toContain("hitSlop={14}");
    expect(styles).toMatch(/citeChip:.*minHeight: 16/);
    expect(styles).not.toMatch(/citeChip:.*borderRadius: 999/);
  });

  it("source sheet is labeled consumer-first", () => {
    const sheet = readFileSync(join(import.meta.dirname, "../src/SourceSheet.tsx"), "utf8");
    expect(sheet).toContain(">Source<");
    expect(sheet).toContain(">Quote<");
    expect(sheet).toContain(">Freshness<");
    expect(sheet).toContain(">Independence<");
    expect(sheet).toContain("Technical details");
    expect(sheet).toContain("translateY");
  });

  it("haptics are optional and bounded", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/haptics.ts"), "utf8");
    expect(src).toContain("Vibration.vibrate");
    expect(src).toContain("never required");
    expect(src).toContain("send: 8");
  });
});
