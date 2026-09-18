# W03/W06 source deletion — integration evidence and canonical update inputs

Implementation base `002e2d6f27e4bcf111cdc48f028a688f55c99713`; metadata HEAD during these checks `ea03632642d8aca1a215cb4e3f1fd02a7c7f66c6`. Changes remain uncommitted for primary review. Exact commands/results/hashes are in RESULTS.json; failed attempts are retained. This is agent review and local synthetic evidence, not independent human validation.

## Behavior and impact

`DELETE /v1/sources/:id` takes an owned source UUID; the existing passage reader now returns `sourceId` alongside `passageId`. Authentication is mandatory; wrong owner/malformed identity is unavailable. Processing-consent revocation does not block privacy deletion. Repeated deletion returns `alreadyDeleted` without another mutation. Response identifies invalidated run IDs and whether legacy file cleanup remains pending.

The domain module owns the account-serialized transaction. It finds all versions/passages of the selected source, every extraction of the same owned uploaded attachment, explicit reused evidence membership and attachment-consuming runs, then conservatively includes descendants because copied question/comparison dependencies are incomplete. It cancels/terminates and increments fences/revisions before removing dependent model contexts, support/calculation/challenge/task results, claim text, reports, events/checkpoints and copied brief/change-summary data. Report rows become redacted tombstones. Unrelated raw source evidence, unrelated runs/accounts and separately owned files remain intact. No entire-account deletion substitutes for source deletion.

Target source/locator/title/metadata, passage text/locators, extractor receipts, raw artifacts and attachment bytes/extraction/name/digest are removed or redacted. Existing `file_deletion_outbox` removes legacy attachment files outside the transaction and retains pending failures. Minimal opaque source/run/version identities and deletion timestamps remain. Existing source/run tombstones deny access and future parent admission; checkpoint_evidence owns the matching admission/insertRun guards, while this packet adds typed correction early rejection before replay. The source deletion itself requires no migration, dependency, prompt, processor, allowance or hosted service.

Financial intents/receipts/amounts are retained. Historical literal request digests and action keys are scrubbed; opaque64-hex request identities are retained. Existing settlement settles known costs but leaves unknown holds reserved until actual receipt reconciliation. Required counterevidence revision markers survive removal of their private derived rows.

## Regression linkage and evidence limits

Six real PostgreSQL/API controls cover correction-snapshot/descendant invalidation with unrelated raw/account preservation; authentication/ownership/idempotency and revoked-consent deletion; repeated attachment extraction plus a late parser result; late model output with receipt-only settlement; actual targeted legacy file unlink; and unknown provider/account holds followed by reconciliation. The parser response and model HTTP response are controlled doubles; this is not extraction fidelity or live semantic quality evidence.

Initial SQL fixture parameter mismatch was corrected without weakening assertions. A second failure exposed that redacted report exports were still available; the export query now excludes `redacted_at` rows. The deletion rejection assertion remains, and existing positive E09/7 unit export controls pass. Final deletion6/6, E09 1 selected/50 deselected, export units7/7 and backend types pass. No paid call, deployment or native build was performed.

## Rollback and remaining scope

Disable new source deletion requests if necessary, but preserve tombstones, invalidated-run admission checks, worker fences, redacted export exclusion, unknown holds/receipt settlement and pending file cleanup. Never restore removed bytes or proof authority. Mobile deletion controls/cache invalidation, external processor retention and backup restore proof remain separate work. Primary must integrate these behavior/impact/test/rollback notes into canonical engine/security/ADR/status/ledger documents and registry; this file is an evidence handoff, not another specification.
