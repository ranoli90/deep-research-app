# Bounded mobile impact

W06/W07: add documents to an owned controlled report, retaining original question and existing evidence. No new dependency/service/provider/model route/migration. Backend owns public append patch, capability and resolver contract. Client strict-validates shared patch before API dispatch.

Local dedicated protected journal uses existing SecureStore content transport and account epoch. It records immutable parent/revision/fixed note and SHA256/upload keys/confirmed IDs, never bytes or picker URI. Ordinary snapshots cannot erase it; actual owned child GET and durable snapshot precede removal. Check/withdraw reads durable IDs, bypasses scheduling preflight and fails closed on malformed/unconfirmed results. Incomplete uploaded-ID journal proves correction POST has not occurred, permitting local withdrawal. Uploaded orphan files remain owned until deleted.

Before new upload, fresh settings must affirm liveRouteEnabled and appendDocumentsAllowed. Same-byte retries reuse upload keys and confirmed IDs. Account/run-bound transient file envelopes hide stale files synchronously and reject delayed picker adoption. Mutation refs block concurrent starts. Consent revocation invalidates active correction view requests. Logout/expiry/account switch/install reset use existing protected key removal/denial controls. Source deletion is blocked while correction identity is unresolved.

Responsibility: App owns presentation, picker and request leases; correction-documents owns strict identity/upload reuse, correction-documents-flow owns durable lookup/recovery/actual snapshot adoption. No ordinary research admission endpoint or pendingAdmission slot is used.

Tests:173 controls total, including25 added correction/upload/storage/flow controls; no assertion deletions. Two early syntax failures and two failed new mocked snapshot controls are retained in RESULTS. JavaScript export is not native acceptance. Backend actual API behavior is separately tested by backend agent and must be integrated before use.

Canonical edits remain primary ownership: MOBILE_SCREEN_STATES, ENGINE_CONTRACTS/API backend contract, ADR/STATUS/HANDOFF/EXECUTION_LEDGER/COMMANDS. Rollback disables new append controls but keeps pending journal restoration and resolve/withdraw, ownership, consent and deletion gates.

Final primary review also repaired branching revision validation, stale UI journal conflicts and active consent view invalidation without changing selected run. Request-scope.invalidateView is account-checked and tested; no additional runtime dependency.
