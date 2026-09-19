# Root-cause map

Do not fix the ledger linearly. Fix root causes in this order.

## Root cause A — semantic state is not uniformly versioned

Symptoms:
- original question rewrite,
- assumptions mutation,
- source-policy steering mutation,
- stale task reuse,
- generic awaiting_input.

Architectural fix:
**immutable original input + revisioned research state + typed pending input**.

Everything that changes research meaning must either:
- create a new brief/controller revision, or
- be explicitly non-semantic confirmation metadata.

The model gets confirmed constraints as structured server-owned context.

## Root cause B — paid operation is not modeled as a durable logical attempt chain

Symptoms:
- fallback persistence under primary intent,
- orphaned fallback unknown,
- repair after unknown-cost invalid output,
- failed-null intents holding budget.

Architectural fix:
`logical model operation → attempt 0 → attempt 1 ...`, each with:
- request digest,
- policy/provider,
- financial state,
- semantic result,
- predecessor/reason.

Unknown attempts never advance.

## Root cause C — outbound-query authority is token heuristic + accumulated permission

Symptoms:
- unknown terms become user-public,
- approved term reused on later query,
- stale pending rows,
- coarse Gate A.

Architectural fix:
Every outbound public query gets a **query authorization proof**:
- exact query digest,
- term provenance,
- brief/controller revision,
- user permission IDs for private-derived terms.

No proof → no public search.

## Root cause D — adaptive research state is mostly ephemeral

Symptoms:
- Evidence Needs disappear on restart,
- queries/classes reset,
- action limit resets,
- candidate completeness is helper-only,
- falsification helper-only.

Architectural fix:
Persist a bounded **Research Controller State**:
- Evidence Needs,
- candidate ledger,
- source strategies attempted,
- query identities,
- challenge obligations,
- next-action/stop reason,
- action counters.

Rebuildable from canonical tables is acceptable if deterministic.

## Root cause E — salvage helpers blur model review vs deterministic proof

Symptoms:
- synthesized support assessments,
- synthesized coverage rows,
- generic heading substitution,
- stale historical evidence reuse.

Architectural fix:
Pick one authority for every decision:
- model proposal,
- deterministic verifier,
- or explicit repair model call.

Never silently convert "model omitted it" into "model supported it."

## Root cause F — "limited report" is an outcome label, not a complete proof contract

Architectural fix:
A limited report must prove:
- every published factual statement is supported,
- every critical unresolved criterion is explicitly represented,
- every required challenge/selection limitation is present,
- no newer consequential evidence invalidates it.

Then the outcome can be `completed_with_limitations`.

## Root cause G — acceptance evidence is manually optimistic

Architectural fix:
Regenerate matrix from exact final SHA and classify evidence:
- unit
- integration
- live provider
- native
- product-quality/manual review.

A helper existing is not a PASS.
