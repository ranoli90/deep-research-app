# Codebase governance — prevent drift mechanically
Owner role: engineering lead. Status: proposed application controls; only review-data checks exist today. Reviewed: 2026-09-16.

## Principle
Future agents should navigate a small map, read the exact contract, make one coherent change and receive machine-detectable failures when they cross boundaries. A large instruction file cannot substitute for those failures. The short-map/mechanical-boundary approach is supported by OpenAI’s published harness experience, but this project retains blocking privacy, security and billing gates rather than copying that team’s merge policy (S31).

## Concrete rules and enforcement to implement
| Rule | Mechanism | Failure example | Ownership / exception |
|---|---|---|---|
| Dependency direction | AST-aware import graph and package export checks in CI; resolve aliases and transitive edges | Screen imports provider SDK, private db service or server env | Architecture lead; ADR plus tests required for a changed edge |
| Module data ownership | Migrations/table-owner manifest; integration tests; restricted repository interfaces | Report renderer updates credit balance directly | Owning service exposes explicit operation; no silent cross-module write |
| External schema validation | One canonical boundary schema; generated types/OpenAPI where appropriate; contract fixtures | Provider adds malformed citations and handler casts to `any` | Adapter rejects/degrades explicitly; never weaken shared schema to fit one bad payload |
| No hidden live calls | Provider access isolated; network-denied unit jobs; separate live command/credential scope | `verify` incurs paid API spend | Live job explicit budget, trace and approval; no skip-to-pass |
| Regression preservation | CI records test count/skip/assertion/snapshot changes, evaluates changed critical contracts | Fix deletes a failing race test or broadens all errors to “unknown” | Required rationale/reviewer for removed protection; not automatic acceptance |
| Prompt/config changes are behavior changes | Prompt/version hash pinned in reports; targeted fixture + relevant heldout evaluation | A wording edit silently changes privacy routing or adds 3 calls | Research + security review as applicable; flag/canary/revert bundle |
| No duplication sprawl | Export and dead-code checks; search existing domain helper before adding one | Fifth retry wrapper with subtly different billing behavior | Put invariants in owning module; no global `utils` junk drawer |
| Documents match code | Canonical owner map, link check, generated-contract drift check, commands registry | README names a nonexistent migration command | Updating code and its canonical contract is one change |
| Completed means evidence | Machine-readable task completion manifest linked to immutable CI artifacts | `STATUS.md` says native tests passed but no device/build evidence | CI provenance is authoritative; prose alone never grants release |

Initial implementation may use existing maintained lint/import tools or a small AST-based checker; select one, pin it and test prohibited imports. Do not install several competing policy frameworks. Grep is useful for discovery but not a complete architecture enforcement mechanism.

## Change packet
Every material feature has a small packet under `specs/features/<id>/` when implementation begins: goal/user outcome; non-goals; affected contract IDs; task boundaries; migrations; privacy/spend impact; tests; rollback and unresolved questions. A small bug fix can use the pull-request description instead of a new document folder.

Each change records base/target commit, files, requirement IDs, exact commands, environment, exit codes, artifact IDs, failed/unrun checks and reviewer role. Never make one agent’s self-grading the sole approval for authorization, money or data deletion. Owner roles in this kit are responsibilities, not claims that employees or independent reviewers exist.

## Review triggers
Always review new dependencies/services, public APIs, schema or migration changes, billing/consent behavior, provider routes, source storage policy, model prompts, and any removed/skipped regression. Routine reversible UI changes can be smaller. Large diffs, deeply nested functions and files combining transport/domain/storage are review signals, not opportunities to split into arbitrary 100-line files with no coherent ownership.

Prefer feature-scoped pull requests. A fix to cancellation should not also replace navigation and the ORM. Disable a faulty new capability rather than removing authorization. Avoid sweeping “cleanup” agents; delete obsolete code in a tested narrow change. Every feature flag has an owner, expiry/review date, default, telemetry and removal task.

## Runtime role hygiene
Role files contain behavioral contracts only. Shared invariants live once in `agents/runtime/CONTRACT.md`. Keep input/output schemas executable in contracts/core after implementation; do not hand-copy a competing JSON schema into every prompt. Role prompts reference IDs and verified capabilities. No test or policy can be weakened by a model-requested tool argument.

## Documentation hierarchy
README maps authorities. Product owns scope; architecture owns module edges; engine owns state/evidence/controller; mobile spec owns interaction; security/cost owns sensitive processing; evaluation owns experiments; acceptance owns scenario IDs. ADRs record why, when and what would reverse a decision. Report findings are explanatory, not another normative spec.

## Repository knowledge maintenance
When a bug reveals a repeated mistake, encode the invariant as a regression or lint before adding more prose. Review stale flags, dead exports, docs links, dependency updates, test flakes and unnecessary abstractions at release checkpoints. Do not run or promise scheduled cleanup outside authorized automation. Lockfile updates and generated schema files must be reproducible.

## Defined commands, not wishful commands
`verification/COMMANDS.json` is machine-readable. A command is `implemented_review_tool` or `proposed_application_command`, with scope and network/spend behavior. When actual application scripts are added, update their status using real execution evidence. Do not report `pnpm verify` working because this review’s Python validator passed.
