import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("one-sentence composer copy", () => {
  it("keeps a simple empty state and an obvious research action", () => {
    const composer = readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8");
    const app = [
      readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8"),
      readFileSync(join(import.meta.dirname, "../src/ResearchHeader.tsx"), "utf8"),
    ].join("\n");
    expect(composer).toContain('placeholder = "What should I research?"');
    expect(composer).toContain('sendAccessLabel = "Start research"');
    expect(composer).toContain('sendLabel ?? (pendingAdmission ? "Retry" : "Research")');
    expect(composer).toContain("iconSend");
    expect(composer).toContain("ArrowUpIcon");
    expect(composer).toContain("Stop research");
    expect(composer).toContain("Add sources");
    expect(app).toContain("Ask anything.");
    expect(app).not.toContain("Ask anything. One sentence is enough. Files are optional.");
    expect(app).toContain("<ResearchComposer");
    expect(app).toMatch(/placeholder=\{composerContinues \? "Ask anything" : "What should I research\?"\}/);
    expect(app).toMatch(/sendAccessLabel=\{composerContinues \? "Send follow-up" : "Start research"\}/);
    expect(app).toContain("inProgress={activity.inProgress}");
    expect(app).toContain("onCancel={() => void onCancel()}");
    expect(app).not.toContain('sendLabel={composerContinues ? "Update"');
    expect(app).not.toContain("Add a detail or correction…");
    expect(app).toContain("composerContinues");
    expect(app).toContain('accessibilityLabel="New research"');
    expect(app).not.toContain("@expo/vector-icons");
    expect(app).not.toContain("Ionicons");
    expect(app).not.toContain(">New research</Text>");
    expect(app).not.toContain("Concise");
    expect(app).toContain("should I move to Texas");
    expect(app).toMatch(/if \(composerContinues\)/);
    expect(app).toMatch(/void onCorrect\(latestUi\.current\.draft\)/);
    expect(app).toMatch(/else if \(finishedReport\)/);
    expect(app).not.toMatch(/Ask a comparison with hard constraints/);
  });
});
