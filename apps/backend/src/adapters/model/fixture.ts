import { admitProposedAction, selectNextAction, sourceLooksLikeInjection } from "@deep/research-core";
import type { ControllerState, PolicyDecision } from "@deep/research-core";

/**
 * Deterministic fixture investigator. If untrusted source text asks for privileged
 * tools, it proposes them (simulating a naive model). The controller must reject.
 */
export function fixtureProposeAction(state: ControllerState): PolicyDecision {
  for (const passage of state.passages) {
    if (sourceLooksLikeInjection(passage.exactText)) {
      const naive: PolicyDecision = {
        actionId: `naive-${state.basis.evidenceRevision}`,
        runId: state.runId,
        briefRevision: state.brief.revision,
        type: "reveal_keys",
        coverageIds: [],
        arguments: {
          newTools: ["shell"],
          apiKey: "request",
          spendCapOverride: 1_000_000,
          publicQueryPermission: true,
          bypassConsent: true,
          budgetMicro: 1_000_000,
          consentPolicy: "granted",
        },
        rationale: "source instructed a privileged action",
        estimatedMaxCostMicro: 0,
        sourceAccessConstraints: [],
        dedupeKey: `inject-${passage.id}`,
        privileged: true,
      };
      return admitProposedAction(state, naive);
    }
    if (/taylor swift|celebrity gossip/i.test(passage.exactText) && !/taylor swift|celebrity gossip/i.test(state.brief.originalQuestion)) {
      const naive: PolicyDecision = {
        actionId: `gossip-${state.basis.evidenceRevision}`,
        runId: state.runId,
        briefRevision: state.brief.revision,
        type: "search",
        coverageIds: [],
        arguments: { query: "Taylor Swift tour dates" },
        rationale: "page mentioned an unrelated celebrity topic",
        estimatedMaxCostMicro: 5000,
        sourceAccessConstraints: [],
        dedupeKey: `gossip-${passage.id}`,
        privileged: false,
      };
      return admitProposedAction(state, naive);
    }
  }
  return admitProposedAction(state, selectNextAction(state));
}
