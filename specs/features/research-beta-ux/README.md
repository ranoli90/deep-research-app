# Research Beta mobile UX

Goal: a one-sentence consumer research experience with truthful activity, an answer-first report, inspectable evidence, conversational corrections, and human settings.

Non-goals: App Store/Play release, iOS device gates, hosted auth, purchases, Living Research, fake chain-of-thought, new backend APIs during the worker phase.

Affected contracts: `specs/MOBILE_SCREEN_STATES.md` composer, clarification, activity, report, source sheet, library, settings. Public run/event/report/source APIs are consumed as they exist.

Task boundary: `apps/mobile/**`, `packages/design/**`, mobile tests, this packet, STATUS/HANDOFF after evidence.

Migrations: none. Privacy/spend: none. Rollback: revert this branch; server admission, deletion, and publication gates are unchanged.

Tests: `pnpm --filter @deep/mobile test` and `typecheck`. Native and live provider evidence are separate.
