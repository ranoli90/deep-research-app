import { createHash } from "node:crypto";
import { LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import type { AppConfig } from "../../platform/config.js";
import { providerFailureState } from "../model/outcomes.js";
import { parseUrlCitations } from "../model/parse.js";
import type { SearchHit } from "./fixture.js";

export type LiveSearchResult = {
  hits: SearchHit[];
  receipt: {
    correlationId: string;
    route: string;
    requestDigest: string;
    state: "issued" | "confirmed" | "failed" | "outcome-unknown";
  };
};

/**
 * Live discovery via OpenRouter web plugin. Hits are snippets/URLs only.
 * Full text requires a later safeFetch of http(s) locators. Isolated from fixture catalog.
 */
export async function liveWebSearch(query: string, config: AppConfig): Promise<LiveSearchResult> {
  const correlationId = crypto.randomUUID();
  const body = {
    model: config.openRouterModel,
    plugins: [{ id: "web", max_results: 3 }],
    messages: [
      {
        role: "user",
        content: `Find up to 3 public web sources for this research query. Return nothing but the sources; do not invent URLs.\n\nQuery: ${query}`,
      },
    ],
  };
  const digest = createHash("sha256").update(JSON.stringify({ q: query, model: config.openRouterModel })).digest("hex");
  const receipt: LiveSearchResult["receipt"] = {
    correlationId,
    route: `openrouter:${config.openRouterModel}:web`,
    requestDigest: digest,
    state: "issued",
  };
  if (!config.openRouterApiKey || config.liveSpendCapMicro <= 0) {
    return { hits: [], receipt: { ...receipt, state: "failed" } };
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      return { hits: [], receipt: { ...receipt, state: "failed" } };
    }
    const json = (await res.json()) as { choices?: { message?: Parameters<typeof parseUrlCitations>[0] }[] };
    const cites = parseUrlCitations(json.choices?.[0]?.message ?? {});
    const hits: SearchHit[] = cites.map((c) => ({
      locator: c.url,
      title: c.title,
      publisher: safeHost(c.url),
      snippet: c.snippet || c.title,
      originCluster: c.url,
      family: safeHost(c.url),
      sourceType: "web",
    }));
    return { hits, receipt: { ...receipt, state: "confirmed" } };
  } catch (err) {
    return { hits: [], receipt: { ...receipt, state: providerFailureState(err as Error) } };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "web";
  }
}

void LIVE_CALL_RESERVE_MICRO;
