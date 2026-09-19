# Acceptance-matrix corrections

- **RB-INTENT-01: FAIL** — originalQuestion mutated in /continue; semantic compiler remains deterministic overlay
- **RB-CLARIFY-01: PARTIAL** — UI/API exists but arbitrary fields coerced to hard eq; no pending-input identity
- **RB-RET-01: PARTIAL** — deep ceiling 6 exists; controller state not durable and loop resets after crash
- **RB-RET-02: FAIL/PARTIAL** — unknown freshness treated as satisfied; effectiveDate/version not fed to strategy
- **RB-RET-03: PARTIAL** — provenance planner exists, but unknown terms default user-public and planner is narrow
- **RB-REC-01: FAIL** — document/web reconciliation remains lexical heuristic
- **RB-API-01: FAIL/PARTIAL** — typed activity object exists but mobile still consumes raw legacy event fields
- **RB-UI-03: FAIL as engineering gate** — assumption edit mutates current brief/report semantics in place
- **RB-NATIVE-02: PARTIAL** — physical IME bar covers send
- **RB-TEST-02: FAIL** — full PG not green at reviewed SHA
- **RB-LIVE-02: PARTIAL** — correction path real; usefulness/semantic revision issues remain
- **RB-CTX-01: PARTIAL** — token-aware input exists; full input+output bound/reservation needs hardening
- **RB-RES-01: PARTIAL** — returned unreadable source degrades; thrown source error can reject batch
- **RB-SEARCH-01: FAIL/PARTIAL** — Azure live route remains maxResults=3
- **RB-FOLLOW-01: PARTIAL** — router classifies; explain route is not a complete user-answer path
- **RB-STEER-01: PARTIAL** — policy mutation is in-place and controller may hold stale state
- **RB-SOURCEPOL-01: FAIL/PARTIAL** — policy encoding exists; direct URL is not actually ingested
- **RB-CAND-01: FAIL** — candidate ledger not production-wired/persisted
- **RB-EVIDENCE-01: FAIL** — Evidence Needs not durable and minimally adaptive
- **RB-FALSIFY-01: FAIL** — per-conclusion falsification helper not wired; one run-level challenge
- **RB-FAILOVER-01: FAIL** — fallback identity/replay persistence bug
- **RB-CONSENT-01: PARTIAL** — privacy filters exist; true multi-provider portfolio not yet operational
- **RB-INJECT-01: PASS with scope** — authority boundary strong; do not overclaim factual poisoning resistance
- **RB-PERF-01: FAIL/PARTIAL** — long live report not measured
- **RB-REPORT-01: PARTIAL** — TOC exists; long-report behavior not proven
- **RB-REPAIR-01: FAIL/PARTIAL** — repair exists but can fire after unknown-cost invalid output; no validator codes
- **RB-BENCH-01: PARTIAL** — diagnostic shapes unit/fixture, not broad live research benchmark

The fix pass must regenerate the whole matrix from the final SHA; this is not an exhaustive replacement matrix.
