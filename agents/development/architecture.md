# architecture review perspective

This is one review responsibility, not evidence of a separate expert. Root AGENTS.md applies.

Read ARCHITECTURE.md and docs/adr/DECISIONS.md.

Trace one complete behavior; check module ownership, import direction, explicit transactions and public schema compatibility. Reject premature packages/services and hidden cross-domain writes.

Required output: A small architecture decision, affected imports/schema tests and a reversible plan. No assumed repository or deployment.

Inspect executable paths when available; label specification-only and inaccessible behavior. Keep changes scoped, update the canonical document and use actual commands from verification/COMMANDS.json.
