import { describe, expect, it } from "vitest";
import { parseActionJson, parseUrlCitations } from "../src/adapters/model/parse.js";
import { knownFinancialOutcome, providerFailureState, providerIntentStateForResult } from "../src/adapters/model/outcomes.js";
import { canIssueLiveCall } from "../src/modules/live-spend.js";
import { LIVE_CALL_RESERVE_MICRO, MICRO_PER_USD } from "@deep/contracts";

describe("live adapter contracts (nonbillable)", () => {
  it("malformed model JSON falls back to synthesize rather than inventing a search", () => {
    expect(parseActionJson("not json")).toEqual({
      type: "synthesize",
      rationale: "unparseable model output; finishing from stored evidence",
      query: undefined,
    });
    expect(parseActionJson('```json\n{"type":"search","rationale":"gap","query":"nimbus matrix"}\n```').type).toBe("search");
    expect(parseActionJson('{"type":"reveal_keys"}').type).toBe("synthesize");
  });

  it("ignores non-http citations from provider annotations", () => {
    const hits = parseUrlCitations({
      annotations: [
        { type: "url_citation", url_citation: { url: "https://example.com/a", title: "A", content: "hello" } },
        { type: "url_citation", url_citation: { url: "fixture://nope", title: "bad" } },
        { type: "other" },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe("https://example.com/a");
  });

  it("timeouts are outcome-unknown; other errors failed", () => {
    expect(providerFailureState({ name: "TimeoutError" })).toBe("outcome-unknown");
    expect(providerFailureState({ name: "AbortError" })).toBe("outcome-unknown");
    expect(providerFailureState({ name: "TypeError", message: "fetch failed" })).toBe("failed");
  });

  it("null-cost HTTP 404 permanent failures are failed, not unknown holds", () => {
    expect(providerIntentStateForResult({ status: "permanent_failure", receipt: { actualMicro: null } })).toEqual({ state: "failed" });
    expect(providerIntentStateForResult({ status: "outcome_unknown", receipt: { actualMicro: null } })).toEqual({ state: "outcome-unknown" });
    expect(providerIntentStateForResult({ status: "succeeded", receipt: { actualMicro: 12 } })).toEqual({ state: "confirmed", confirmedMicro: 12 });
    expect(providerIntentStateForResult({ status: "invalid_output", receipt: { actualMicro: null } })).toEqual({ state: "outcome-unknown" });
    expect(knownFinancialOutcome({ status: "invalid_output", receipt: { actualMicro: null } })).toBe(false);
    expect(knownFinancialOutcome({ status: "invalid_output", receipt: { actualMicro: 2 } })).toBe(true);
    expect(knownFinancialOutcome({ status: "permanent_failure", receipt: { actualMicro: null } })).toBe(true);
    expect(knownFinancialOutcome({ status: "outcome_unknown", receipt: { actualMicro: null } })).toBe(false);
  });

  it("LIVE_SPEND_CAP_MICRO is USD micros and refuses a call that would exceed remaining", () => {
    expect(MICRO_PER_USD).toBe(1_000_000);
    expect(LIVE_CALL_RESERVE_MICRO).toBe(200_000);
    expect(canIssueLiveCall({ capMicro: 0, usedMicro: 0 }).ok).toBe(false);
    expect(canIssueLiveCall({ capMicro: 5_000_000, usedMicro: 4_900_000 }).ok).toBe(false);
    expect(canIssueLiveCall({ capMicro: 5_000_000, usedMicro: 100_000 }).ok).toBe(true);
    expect(canIssueLiveCall({ capMicro: 5_000_000, usedMicro: 100_000 }).remainingMicro).toBe(4_900_000);
  });
});
