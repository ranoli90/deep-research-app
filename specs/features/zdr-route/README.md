# W02/W05/W08 — explicit ZDR-compatible model route

Trigger: the registered OpenAI-only request receives a real404 because the account requires ZDR. OpenRouter's ZDR endpoint metadata lists Azure hosting the same gpt-4o-mini model at the same base input/output tariff. Preserve the user's privacy setting.

Implementation boundary: add an immutable server-owned model policy per admitted run, default old runs to the exact OpenAI-v1 policy; allow an explicit Azure-ZDR-v1 configuration for new runs. Children inherit parent policy. Resolve transport, recovery, support/publication and financial metadata against the persisted policy; unknown policies fail closed before provider issuance. Retain old request byte identities and reports. No general fallback, agent framework, new service or dependency.

Impact checklist: one additive PostgreSQL migration; internal model policy registry and configuration, updated processor disclosure/consent version. Azure is disclosed by name. Preserve current provider cost ceilings and model/schema/prompts, route/provenance validation, atomic reservations, fences and exact unknown-attempt identities. Capability metadata is not a paid quality pass. Azure uses max_completion_tokens and ZDR=true explicitly. No deployment or account privacy setting mutation.

Tests: old bytes/replay, new Azure request pin and mismatched-provider rejection, admission/correction inheritance, unsupported policy before cost, both policies through actual PostgreSQL writer/support/publication controls, receipt reconciliation routed by immutable policy. Live comparison must retain earlier404 failures and use the same route in both arms. Do not reissue old unknown attempts.

Rollback: disable new Azure admission; retain both immutable policy readers, consent and financial records. Never reinterpret an admitted run's policy or remove privacy gates.

Live follow-on (ADR060): first Azure response had invalid exact offsets; new opt-in v2 policy adds deterministic unique-exact coordinate resolution with an audit event and unchanged post-transform validation. No source text or authority is changed. The second live request timed out and retains its reserve.
