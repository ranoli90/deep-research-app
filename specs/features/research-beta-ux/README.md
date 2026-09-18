# Research Beta mobile UX

Goal: a one-sentence consumer research experience with truthful activity, an answer-first report, inspectable evidence, conversational corrections, and a calm Profile (avatar/account, appearance, privacy, quiet demo switch, sign out; no bottom tabs on that screen).

Live sources: during search, Grok-style activity lines; domain pills only from real public URLs on events (no inventing hosts/favicons, no favicon CDN). After search, numbered citation chips (no UUIDs) and a quote-first source sheet. See `specs/MOBILE_SCREEN_STATES.md` §§4 and 7.

Non-goals: App Store/Play release, iOS device gates, hosted auth, purchases, Living Research, fake chain-of-thought, new backend APIs during the worker phase.

Affected contracts: `specs/MOBILE_SCREEN_STATES.md` composer, clarification, activity, report, source sheet, library, settings. Public run/event/report/source APIs are consumed as they exist.

Library chrome (ADR064): remove the Research|Library bottom tab. Research is the home surface. Library opens full-screen (phone) or as a left drawer/pane (wide) from the header Menu and from Profile → Library. Rows show title, Ready/Researching (etc.), version, time; support search, share, swipe. New research stays a Research/Library header action that clears local focus without cancelling server work or deleting history.

Task boundary: `apps/mobile/**`, `packages/design/**`, mobile tests, this packet, STATUS/HANDOFF after evidence.

Migrations: none. Privacy/spend: none. Rollback: revert this branch; server admission, deletion, and publication gates are unchanged.

Tests: `pnpm --filter @deep/mobile test` and `typecheck`. Native and live provider evidence are separate.
