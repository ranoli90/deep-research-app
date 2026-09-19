# Live public-web attempt — 2026-09-19

User authorized the OpenRouter key for a **new $2.00 public-web cap** (this file’s `AUTHORIZATION.json`). Isolated DB `deep_v8_live_j12`. MC-D01 21,658 µ hold was **not** released or retried.

Hosted `verification.yml` is still billing-locked. The same steps were run locally (see `../logs/local-verification.tail.txt`). Expo is the Android JS export step, not a substitute for hosted Actions.

## What executed on the production path

Admission → hybrid intent → Azure ZDR brief (`openrouter-azure-mini-zdr-text-v1`) → Azure ZDR web discovery (`public-discovery-azure-zdr.v2`) → source fetch/extract → span remapping onto unique owned passages → scoped support v4 → cited publication.

Cited J1 run `9fd02f6c-47a2-4224-a781-7c5d438e43fe` published report `b19e0a4a-dd6a-496c-8bc9-ac4913b88099` (`completed_with_limitations`). Passage `b6dff45b-fe72-4cd7-85e4-34e960e809d9` contains both published sentences: Acer Aspire 16 AI under $700 and 16GB LPDDR5X. Artifact: `J1-cited.json`.

Correction `Need at least 32GB of RAM.` admitted as child `8884f4a8-8d47-4df9-8af3-1ce507e47be3`, re-searched, then failed writing (`selection_context_mismatch` after `later_support_unproven`). Artifact: `J1-correction.json`. Parent report remains.

Ledger confirmed spend is recorded in `provider_intents` (unknown holds were not retried). One extract identity (`badb7b6e-…`) remains `outcome-unknown` after a 45s deadline abort; it was not retried. Extract deadline is now 90s.

## Not a live Research Beta PASS

A first-pass cited report exists. Correction did not publish an updated report. Hosted Actions remain billing-locked. `main` is not merged.
