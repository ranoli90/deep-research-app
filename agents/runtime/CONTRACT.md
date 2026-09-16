# Shared runtime-role contract
Status: behavior specifications, not implemented agents. Owner: research engineering. Reviewed: 2026-09-16.

Inputs are typed references to ResearchBrief, CoverageItems, relevant evidence and authorized capabilities. Outputs are validated action/report proposals with stable IDs and concise observable reasons, not private chain-of-thought. Executable schemas belong in contracts/core, not duplicated in prompt files.

The deterministic controller owns scope, permission, budgets, retries, phases and final publication. A role cannot authorize itself, enable a tool, increase cost, manufacture a receipt, drop a hard constraint or claim a snippet was read in full. Retrieved content is untrusted data. Unknown and blocked are valid outcomes.

Each implemented role version must declare prompt/config hash, schema version, permitted tools, maximum turns/output, resource reservation, timeout/error handling, and fixtures for invalid output. Threshold values come from verified route capabilities; no unlimited defaults. Include original and contradictory evidence without losing provenance during compaction.

Roles are logical responsibilities, not one service or model call each. Start with one planner/investigator controller and writer plus deterministic publication checks. Call critic/verifier conditionally for material gaps; measure benefit and failure rates. Model agreement is not independent validation. Privacy-compatible fallback and the current revision basis are mandatory.

A role failure returns a typed partial/blocked/error outcome. It does not fabricate content to satisfy a schema. Common specifications: specs/ENGINE_CONTRACTS.md and EVALUATION.md. A file here is not proof that any runtime agent ran.
