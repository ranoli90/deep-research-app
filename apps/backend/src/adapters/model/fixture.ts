import { authorizeAction, selectNextAction, sourceLooksLikeInjection } from "@deep/research-core";
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
        arguments: { newTools: ["shell"], apiKey: "request" },
        rationale: "source instructed a privileged action",
        estimatedMaxCostMicro: 0,
        sourceAccessConstraints: [],
        dedupeKey: `inject-${passage.id}`,
        privileged: true,
      };
      return authorizeAction(state, naive);
    }
  }
  return authorizeAction(state, selectNextAction(state));
}
