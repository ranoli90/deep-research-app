import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("one-sentence composer copy", () => {
  it("keeps a simple empty state and an obvious research action", () => {
    const composer = readFileSync(join(import.meta.dirname, "../src/ResearchComposer.tsx"), "utf8");
    const app = [
      readFileSync(join(import.meta.dirname, "../App.tsx"), "utf8"),
      readFileSync(join(import.meta.dirname, "../src/ResearchHeader.tsx"), "utf8"),
      readFileSync(join(import.meta.dirname, "../src/composer-copy.ts"), "utf8"),
      readFileSync(join(import.meta.dirname, "../src/EmptyHome.tsx"), "utf8"),
    ].join("\n");
    expect(composer).toContain('placeholder = "What are you trying to understand?"');
    expect(composer).toContain('sendAccessLabel = "Start research"');
    expect(composer).toContain('sendLabel ?? (pendingAdmission ? "Retry" : "Research")');
    expect(composer).toContain("iconSend");
    expect(composer).toContain("ArrowUpIcon");
    expect(composer).toContain("Stop research");
    expect(composer).toContain("Add sources");
    expect(app).toContain("Research what");
    expect(app).toContain("Understand the evidence. See the trade-offs.");
    expect(app).toContain("What are you trying to understand?");
    expect(app).not.toContain("Ask anything. One sentence is enough. Files are optional.");
    expect(app).toContain("<ResearchComposer");
    expect(app).toContain("composerDockBottomInset");
    expect(app).toContain("keyboardInset");
    expect(app).toContain("composerPlaceholder");
    expect(app).toContain("Ask or refine research");
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
    expect(app).not.toContain("should I move to Texas");
    expect(app).toContain("Choose a starting point");
    expect(app).toMatch(/onComposerFollowUp/);
    expect(composer).toContain("editable={editable}");
    expect(composer).toContain("inProgress && Boolean(onCancel) && !hasDraft");
    expect(composer).toContain("stopBesideSend");
    expect(composer).not.toContain("editable={editable && !stop}");
    expect(app).not.toContain("composerContinues && !correctionReady");
    expect(app).toContain("const composerContinues = finishedReport;");
    expect(app).not.toMatch(/Ask a comparison with hard constraints/);
    expect(app).toContain("correctionMode!==\"unavailable\"");
    expect(app).toMatch(/if \(mutates && !correctionReady\)/);
    expect(app).toContain('error: "Additional research is not available on this route. You can still ask for an explanation from this report."');
  });
});
