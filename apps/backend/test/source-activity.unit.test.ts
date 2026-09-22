import { describe, expect, it } from "vitest";
import {
  SOURCE_ACTIVITY_VERSION,
  citedPassageIds,
  summarizeSourceActivity,
} from "../src/modules/source-activity.js";

const handle = (sourceId: string, originCluster: string | null = "cluster-a") => ({ sourceId, originCluster });

describe("source activity distinct counters", () => {
  it("counts three passages from one document as one cited source and three passages", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1")],
      read: [handle("doc-1")],
      cited: [
        { ...handle("doc-1", "publisher-a"), versionId: "v1", passageId: "p1" },
        { ...handle("doc-1", "publisher-a"), versionId: "v1", passageId: "p2" },
        { ...handle("doc-1", "publisher-a"), versionId: "v1", passageId: "p3" },
      ],
      reportPresent: true,
    });
    expect(counts.version).toBe(SOURCE_ACTIVITY_VERSION);
    expect(counts.discoveredSources).toBe(1);
    expect(counts.readSources).toBe(1);
    expect(counts.citedSources).toBe(1);
    expect(counts.citedVersions).toBe(1);
    expect(counts.citedPassages).toBe(3);
    expect(counts.independentOrigins).toBe(1);
    expect(counts.citedSourceHandles).toEqual([{ sourceId: "doc-1", originCluster: "publisher-a" }]);
  });

  it("distinguishes documents, versions, passages, and independent-origin groups", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1"), handle("doc-2")],
      read: [handle("doc-1"), handle("doc-2")],
      cited: [
        { sourceId: "doc-1", originCluster: "wire-service", versionId: "v1", passageId: "p1" },
        { sourceId: "doc-1", originCluster: "wire-service", versionId: "v2", passageId: "p2" },
        { sourceId: "doc-2", originCluster: "primary-regulator", versionId: "v3", passageId: "p3" },
      ],
      reportPresent: true,
    });
    expect(counts.citedSources).toBe(2);
    expect(counts.citedVersions).toBe(3);
    expect(counts.citedPassages).toBe(3);
    expect(counts.independentOrigins).toBe(2);
  });

  it("does not inflate read counts from duplicate or retried read rows", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1"), handle("doc-2")],
      read: [handle("doc-1"), handle("doc-1"), handle("doc-2")],
      cited: [],
      reportPresent: false,
    });
    expect(counts.readSources).toBe(2);
    expect(counts.discoveredSources).toBe(2);
  });

  it("omits cited and origin counts when no owned report exists", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1")],
      read: [handle("doc-1")],
      cited: [],
      reportPresent: false,
    });
    expect(counts.citedSources).toBeNull();
    expect(counts.citedVersions).toBeNull();
    expect(counts.citedPassages).toBeNull();
    expect(counts.independentOrigins).toBeNull();
    expect(counts.citedSourceHandles).toBeNull();
  });

  it("omits independent origins when any cited source origin is unknown", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1"), handle("doc-2")],
      read: [handle("doc-1"), handle("doc-2")],
      cited: [
        { sourceId: "doc-1", originCluster: "wire-service", versionId: "v1", passageId: "p1" },
        { sourceId: "doc-2", originCluster: null, versionId: "v2", passageId: "p2" },
      ],
      reportPresent: true,
    });
    expect(counts.citedSources).toBe(2);
    expect(counts.independentOrigins).toBeNull();
  });

  it("reports zero independent origins for a report with no cited sources", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1")],
      read: [handle("doc-1")],
      cited: [],
      reportPresent: true,
    });
    expect(counts.citedSources).toBe(0);
    expect(counts.independentOrigins).toBe(0);
    expect(counts.citedSourceHandles).toEqual([]);
  });

  it("normalizes origin clusters and keeps first-appearance cited passage order", () => {
    const counts = summarizeSourceActivity({
      discovered: [handle("doc-1"), handle("doc-2")],
      read: [handle("doc-1"), handle("doc-2")],
      cited: [
        { sourceId: "doc-1", originCluster: " Wire-Service ", versionId: "v1", passageId: "p1" },
        { sourceId: "doc-2", originCluster: "wire-service", versionId: "v2", passageId: "p2" },
      ],
      reportPresent: true,
    });
    expect(counts.independentOrigins).toBe(1);
    expect(citedPassageIds([
      { citationIds: ["p2", "p1"] },
      { citationIds: ["p1", "p3"] },
      { citationIds: ["p3"] },
    ])).toEqual(["p2", "p1", "p3"]);
  });
});
