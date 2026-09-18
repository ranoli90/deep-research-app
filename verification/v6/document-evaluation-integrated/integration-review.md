# Integrated read-only review: runner and document corrections

Reviewed current root working source, including integrated append packet, not old clone. No source edits, tests, DB, native, network or paid requests. Same-model engineering review, not independent human adjudication.

## Actionable finding

**Approval expiry can pass during asynchronous pre-admission work.** `apps/backend/src/evaluation/runner.ts:24` checks wall time before `await driver.exposure()` at29 and `await journal(attempt)` at34. Admission at37 has no subsequent expiry check. A delayed database exposure query or fsync can therefore admit a new step after its grant expires. This missing post-await validation is confirmed by source inspection; runtime reproduction was not performed under this read-only assignment. Proposed narrow regression: fake clock advances past expiresAt inside exposure and separately the attempt journal; no driver.admit call, and current/remaining steps receive explicit expired/unrun records. Fix should revalidate immediately before calling admission. This does not assert an admitted run must be cancelled midrun; deadline semantics for already-admitted work remain distinct.

## Boundaries retained in reviewed source

- Authorization loader validates explicit operator attestation, grant hash/approval identity/window and registered hashes; only question strings enter generator task projection (`evaluation/authorization.ts`). Attestation is documented as an operator gate, not proof of human approval.
- Runner serializes attempts, retains the full denominator/unrun reasons, stops after unknown outcomes or receipt/journal failure and leaves semantic/adjudication fields null (`evaluation/runner.ts:19-44`). Unsupported frozen-document mode stops without provider execution. Available mode is live discovery, not full corpus-quality proof.
- Production driver uses authenticated existing API admission and actual `processRun`, caps configured account/project/key exposure conservatively, includes unattributed liabilities and checks existing nonterminal work (`evaluation/production-driver.ts:12-43`). Original arm strategy is captured at admission; correction inherits parent strategy through `modules/runs.ts:110`. Passing an idempotency header on correction is not its identity: backend exact accepted patch/parent/revision/text digest is authoritative.
- Append admission keeps parent question, accepts only owned live new attachments within combined cap, inherits immutable evidence, recomputes assertions and marks no public rediscovery (`modules/research-corrections.ts:19-55`). Private note/filename is not substituted for original public question. Whole/span semantics remain separate.
- Recovery serializes exact accepted identity with account deletion/admission withdrawal, verifies stored child parent/patch binding, and remains read/withdraw-only without fresh consent or scheduling (`modules/research-corrections.ts:60-80`). It does not release unknown financial liabilities or cancel accepted work.
- Appended-document obligation derives from immutable owned parent/child briefs before task setup; actual readable authorized passage must bind current attachment digest and locator (`worker/structured-research.ts:38-66`). Missing change-set does not erase the obligation. Public discovery/refinement is denied/skipped with attachments (`:87-95`, `:136`); prior source text cannot expand public query authority.
- Rollback must preserve typed correction parsing, required new-document guard, exact recovery/withdrawal identity, source/account deletion and receipt/unknown-hold handling. Stopping new scheduling must not revert admitted proof readers.

No other concrete authority/ownership/private-query defect identified in this bounded review. This is not exhaustive correctness or live-quality proof.

## Source hashes at review

- `apps/backend/src/evaluation/authorization.ts`: `52827d38fe17525c142ab3597fe4d4acd7b60ef8eeab987409e6ef5118ef7408`
- `apps/backend/src/evaluation/runner.ts`: `e652e87b31a81a9e99ac1652bacdf3f3fbe3b3a69e2ed28a38e2df4cc1d1b854`
- `apps/backend/src/evaluation/production-driver.ts`: `d01a3e7596ce8ebf406dc4ed3c770961832da712ab03bde9c112a3a11c190bad`
- `apps/backend/src/eval-live.ts`: `969d02070ae377e00cd15ede1a6f369c08d9eff41e3333b235a6b14f74aac7c8`
- `apps/backend/src/modules/research-corrections.ts`: `ab39baf201c72a9a74564e3c15270b3c5eecc8c2a98114f9a28223adaf6a8d38`
- `apps/backend/src/worker/structured-research.ts`: `c69f49dc426e14654326dd8ebfdfc922875e1b4b8015751d69ae5672048b109c`
