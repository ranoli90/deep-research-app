# Norrow guest-first authentication and claim

Requirement IDs: Norrow kit GUEST-01–14, CLAIM-01–16, AUTH-01–11, DATA-01–12, COST-01–08, SCALE-01/07, NATIVE-04/05. [ADR079](../../../docs/adr/DECISIONS.md) is the single protocol authority. Kit chapters 04, 05, 08, 12 and 13 define the product/security inputs; this packet maps that decision onto repository work and must not restate a competing protocol.

User outcome: one consented, sponsored first text/public-URL submission occurs without registration. On Send of the second distinct action, the app preserves its exact action identity/draft and opens sign-in. After verified Clerk identity and an exact conversation claim, it resumes that unchanged action once. A clarification answer is that second action, not a rewritten research question. Scoped guest reading/citations/cancel/deletion remain available until claim or terminal lifecycle state.

Non-goals: Clerk anonymous users, client-only counting, email identity merge, broad owner aliases, historical ownership rewrite, unlimited/welcome allowance, unsupported guest mutations, public activation/release, or a second research path.

## Repository impact map

| Boundary | Required implementation outcome | ADR079 section |
| --- | --- | --- |
| Contracts | Strict guest bootstrap/proof metadata, admission/resolve, claim/claim-resolution, pending-action and safe error schemas; clients cannot name execution owner/payer | resolver matrix; pending handoff |
| Backend auth | Provider-neutral verified-identity boundary; Clerk customer-session verifier/JWKS and raw-webhook verifier; issuer/subject mapping preserves internal IDs; verified deletion/revocation invokes the same local member-deletion fanout | provider-neutral identity; member deletion and external revocation fanout |
| Backend authority | One typed scope resolver used by every enumerated current endpoint, including cost, attachment metadata, settings/capabilities, purchase restore/verify and both account-deletion paths; member continuation creates a member-owned child while guest parent execution stays immutable | immutable execution; resolver matrix |
| Admission/accounting | Atomic context/trial/policy/ledger/reservation/outbox transaction, server kill switch and HOLD preservation across replicas | admission, sponsor accounting |
| Lifecycle/worker | Monotone claim/expiry/deletion state, declared lock order, member-deletion/revocation tombstones and cleanup fanout, HOLD preservation, and current consent/deletion/cancel/fence checks at lease/issuance/checkpoint/publication | claim, lifecycle, consent; member deletion and external revocation fanout |
| Persistence | Additive guest context, control binding, receipt, pending-action and tombstone records under migration lock; no `account_id` rewrite | immutable execution; lifecycle |
| Mobile | Secure proof transport and token-free protected handoff journal; each handoff binds source and adopted principal/view/control epochs, while token refresh changes only credential generation | proof transport; pending handoff |

The required resolver inventory is the ADR079 matrix. It is endpoint-level and explicitly includes `/v1/runs/:id/cost`, attachment metadata, settings/capabilities, purchase restore/verify, legacy and `/v1` member-deletion routes, guest admission/read/safety, claimed reads/library/export, every work-creating child action, upload, billing, worker/outbox and webhook/operator paths. A new account-scoped endpoint is blocked until it has a row, scope type, and route regression.

## Required implementation evidence

| Test suite / journey | Required acceptance linkage |
| --- | --- |
| `norrow-guest-admission.integration` | GUEST-01–14; COST-01/05/07/08; SCALE-01/07 |
| `norrow-claim-scope.integration` | CLAIM-01–16; DATA-12; all resolver rows; claimed-child clarification continuation |
| `norrow-lifecycle-race.integration` | DATA-01/02/06–09; COST-02; claim/expiry/delete/cancel/HOLD/restore races |
| `norrow-sponsor-ledger.integration` | COST-01–08, including policy/ledger lock, kill switch, and unknown outcomes |
| `clerk-identity-adapter.unit`, `clerk-webhook.integration` | AUTH-01–11; PROVIDER-10/11/14 |
| `guest-pending-action` mobile tests and physical native journeys | NATIVE-04/05; provider cancellation; token refresh; account/view/control switches; exact-once clarification resume |

## Protocol-repair acceptance mapping

The following controls are mandatory additions to the named suites above. They are requirement/test linkage, not claimed execution evidence; their exact locks, tombstones, cleanup and fencing behavior is owned by ADR079.

| Requirement | Required regression and observable result | Primary suite |
| --- | --- | --- |
| `CLAIM-09` | Race claim with expiry, guest deletion and member deletion using independent PostgreSQL clients. Exactly one serialized terminal result is durable; no expired/deleted context is adopted, and no loser learns resource state. | `norrow-lifecycle-race.integration` |
| `DATA-08` | Begin member deletion while a claim, verified Clerk delete/revocation webhook and OAuth callback are queued. Assert tombstones/control-version and member deletion epoch deny every claimed parent/child/read route; cleanup outbox is idempotent; no late message recreates identity/content. | `norrow-lifecycle-race.integration`, `clerk-webhook.integration` |
| `AUTH-06` | Refresh Clerk credentials during stream, claim and adoption. Assert only `credentialGeneration` changes; the protected journal's principal/view binding, draft and one intended handoff remain valid. | `guest-pending-action`, physical native journey |
| `AUTH-07` | Logout, same-account re-login, cold restart during auth, and account switch during auth/claim/adoption. Assert exact-attempt server readback before original-ID continuation or terminal cancellation, no new provider before an end receipt, stale callbacks fail, and a differently bound member cannot mount the encrypted guest reader/draft. | `guest-pending-action`, mounted `guest-app.component`, physical native journey |
| `AUTH-08` | Use the real request-scope manager to exercise intended claim adoption. Assert the exact post-login principal epoch and adopted view epoch are accepted once; unrelated navigation remains rejected. | `guest-pending-action`, `norrow-claim-scope.integration` |
| `CLAIM-15` | Edit the message, switch view/account, dismiss, cancel or revoke consent during auth. Assert the immutable pending action cannot auto-dispatch; a fresh explicit Send is required and no second child/provider intent is created. | `guest-pending-action`, `norrow-claim-scope.integration` |
| HOLD preservation | Delete/revoke a member owning claimed guest material while its original sponsored provider outcome is unknown. Assert content is denied/cleaned, but sponsor intent/receipt/HOLD remains immutable and no retry, release, charge or new credit occurs. | `norrow-lifecycle-race.integration`, `norrow-sponsor-ledger.integration` |

All database races use independent PostgreSQL clients and production request serializers. Component tests and synthetic providers do not establish hosted/native/provider success. This packet claims no scenario has passed until receipts are recorded against the candidate SHA.

Impact checklist: new Clerk service/SDK/configuration, additive migrations, public schemas, authentication, consent, sponsor budget, deletion, worker publication, and native secure storage. No new model/provider route, prompt, processor, hidden paid call, allowance increase, or public guest activation is authorized. Existing internal accounts and financial identities remain stable.

Rollback: default-deny new bootstrap/admission/resume, preserving resolver readers, binding/lifecycle tombstones, immutable parent execution, member child records, receipts/reservations and HOLD. Never rewrite owner IDs, erase claim/tombstone data, reactivate a proof, broaden resolver predicates, or blindly resend an issued operation.
