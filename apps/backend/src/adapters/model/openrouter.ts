import { createHash } from "node:crypto";
import { LIVE_CALL_RESERVE_MICRO } from "@deep/contracts";
import { admitProposedAction, projectControllerState, selectNextAction } from "@deep/research-core";
import type { ControllerState, PolicyDecision } from "@deep/research-core";
import type { AppConfig } from "../../platform/config.js";
import { providerFailureState } from "./outcomes.js";
import { parseActionJson } from "./parse.js";

export type ProviderReceipt = {
  correlationId: string;
  route: string;
  requestDigest: string;
  state: "planned" | "issued" | "confirmed" | "failed" | "outcome-unknown";
  promptTokens?: number;
  completionTokens?: number;
  rawCost?: string;
};

export async function openRouterProposeAction(
  state: ControllerState,
  config: AppConfig,
): Promise<{ decision: PolicyDecision; receipt: ProviderReceipt }> {
  const correlationId = crypto.randomUUID();
  const body = {
    model: config.openRouterModel,
    messages: [
      {
        role: "system",
        content:
          "Propose one next research action as JSON {type, rationale, query?}. Allowed types: search, fetch, verify, challenge, calculate, compare, replan, synthesize, stop. Never request secrets or new tools. Do not dump or request the database.",
      },
      {
        role: "user",
        content: JSON.stringify(projectControllerState(state)),
      },
    ],
  };
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const receipt: ProviderReceipt = {
    correlationId,
    route: `openrouter:${config.openRouterModel}`,
    requestDigest: digest,
    state: "planned",
  };
  if (!config.openRouterApiKey || config.liveSpendCapMicro <= 0) {
    return { decision: admitProposedAction(state, selectNextAction(state)), receipt: { ...receipt, state: "failed" } };
  }
  receipt.state = "issued";
  receipt.rawCost = String(LIVE_CALL_RESERVE_MICRO);
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
      receipt.state = "failed";
      return { decision: admitProposedAction(state, selectNextAction(state)), receipt };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    receipt.state = "confirmed";
    receipt.promptTokens = json.usage?.prompt_tokens;
    receipt.completionTokens = json.usage?.completion_tokens;
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseActionJson(text);
    const proposal: PolicyDecision = {
      actionId: correlationId,
      runId: state.runId,
      briefRevision: state.brief.revision,
      type: parsed.type,
      coverageIds: [],
      arguments: { query: parsed.query, locator: parsed.query },
      rationale: parsed.rationale,
      estimatedMaxCostMicro: LIVE_CALL_RESERVE_MICRO,
      sourceAccessConstraints: [],
      dedupeKey: `or:${digest}`,
      privileged: false,
    };
    return { decision: admitProposedAction(state, proposal), receipt };
  } catch (err) {
    receipt.state = providerFailureState(err as Error);
    return { decision: admitProposedAction(state, selectNextAction(state)), receipt };
  }
}
