# Executive verdict

**Do not start the dedicated UI phase yet.**

The V8.1 branch contains a serious amount of good engineering, but the second-pass review found a pattern that matters more than the raw test count:

> Live-quality fixes repeatedly changed foundational semantics (support repair, coverage repair, question mutation, historical evidence reuse, discovery behavior) to make a journey succeed, and some of those changes weakened unrelated fail-closed contracts.

The current fix pass therefore needs to be a **correctness hardening pass**, not a "get 480 tests green" pass.

## Highest-risk root causes

1. **Brief/revision semantics are inconsistent.**
   - Clarification can rewrite `originalQuestion`.
   - Assumptions and steering can mutate a brief in place.
   - The task digest does not cover all planning state.

2. **Provider failover/accounting is not crash/replay safe.**
   - Fallback result can be saved under the primary intent ID.
   - Fallback unknown state can be orphaned.
   - Known failures with null cost can still behave like unknown liabilities.
   - Repair calls can be sent after an unknown-cost invalid response.

3. **Private-query authorization is not as exact as the acceptance matrix says.**
   - Unknown terms default to `user-public`.
   - Approved terms can be reused across queries.
   - Pending approvals are not consumed.

4. **The "deep research intelligence" layer is partially scaffolding.**
   - Evidence Needs are not durable.
   - Candidate ledger is not production-wired.
   - Per-conclusion falsification is not production-wired.
   - Reconciliation remains lexical.
   - The so-called semantic intent overlay remains deterministic rules.

5. **The real Azure path is shallower than the matrix says.**
   - Azure ZDR discovery still has `maxResults=3`.

6. **Limited publication has a coverage bypass.**
   - `completed_with_limitations` can skip ordinary structured coverage restoration.

7. **The typed safe activity contract is not the mobile authority.**
   - Mobile still renders legacy `type/publicSummary`; API still returns raw publicSummary.

8. **The acceptance matrix is not trustworthy enough to gate the merge.**
   Multiple PASS rows are contradicted by the implementation or their own evidence text.

## Count

This audit records **126 findings**:
- P0: 26
- P1: 58
- P2: 38
- P3: 4

Not every P2/P3 must block Research Beta. Every P0 and every P1 that affects correctness/privacy/spend/publication **does**.

## Important positive conclusion

The repo is not a mess. Several foundations are genuinely strong: fences/leases, SSRF/pinned transport, immutable typed correction child runs, evidence-selection proofs, exact span checking, deletion/tombstones, and outbox/idempotency foundations. The fix pass should **preserve those** rather than rewrite the whole system.
