# Recovered Grok worktree map — 2026-09-20

This index records the actual Grok source work found in local Git worktrees.
Screenshots and ZIP handoff packets are not part of this source recovery.

## Grok branches with source commits

- `grok-v7/intelligence-governor` — already on GitHub; clean.
- `grok-v7/product-integration` — already on GitHub; clean.
- `grok-v7/retrieval-evidence` — already on GitHub; clean.
- `grok-v8/phase-a-api` — local Grok commits through `e658bd7`.
- `grok-v8/phase-a-followup` — local Grok commits through `9b9f2dd`.
- `grok-v8/bb01-adoption-guard` — local Grok fix through `fa24808`.
- `grok-v8/bb02-historical-gaps` — local Grok fix and held-out regression through
  `3116f6e`.
- `grok-v8/bb03-journal-parse` — local Grok fix through `b818a1c`.
- `grok-v8/research-beta-integration` — already on GitHub through `bb80cfd`.

The local-only branches are preserved as separate branches so their review
boundaries and worktree ownership remain visible. They are not silently merged
into `main`.

## Grok work that was still uncommitted

`grok-v8/bb-independent-tests` contained three source test files:

- `apps/backend/test/historical-shortcut-heldout.integration.test.ts`
- `apps/mobile/test/follow-up-journal.test.ts`
- `packages/research-core/test/historical-shortcut-heldout.test.ts`

These are held-out independent regressions. They expose failures against the
current branch baseline (24/36 mobile tests and 21/28 research-core tests
failed in the targeted run), so they are preserved as failing evidence rather
than represented as a green verification result.

The `grok-v8/phase-a-state` worktree also has two uncommitted edits, but that
worktree is a Codex lane, not Grok work, and is intentionally excluded from
this recovery.

## Verification boundary

The Grok v7/v8 branch commits are source work and should be reviewed or merged
according to their branch contracts. Existing GitHub branches remain intact.
No deployment, paid model call, Apple submission, or release approval is
implied by publishing these branches.
