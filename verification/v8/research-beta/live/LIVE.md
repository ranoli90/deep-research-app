# Live public-web attempt — 2026-09-19

User authorized the OpenRouter key for a **new $2.00 public-web cap** (this file’s `AUTHORIZATION.json`). Isolated DB `deep_v8_live_j12`. MC-D01 21,658 µ hold was **not** released or retried.

Hosted `verification.yml` is still billing-locked. The same steps were run locally (see `../logs/local-verification.tail.txt`). Expo is the Android JS export step, not a substitute for hosted Actions.

## What executed on the production path

Admission → hybrid intent → Azure ZDR brief (`openrouter-azure-mini-zdr-text-v1`) → Azure ZDR web discovery (`public-discovery-azure-zdr.v2`) → source fetch/extract → span remapping onto unique owned passages → scoped support v4 → cited publication.

Cited J1 run `9fd02f6c-47a2-4224-a781-7c5d438e43fe` published report `b19e0a4a-dd6a-496c-8bc9-ac4913b88099` (`completed_with_limitations`). Passage `b6dff45b-fe72-4cd7-85e4-34e960e809d9` contains both published sentences: Acer Aspire 16 AI under $700 and 16GB LPDDR5X. Artifact: `J1-cited.json`.

First correction `Need at least 32GB of RAM.` admitted as child `8884f4a8-8d47-4df9-8af3-1ce507e47be3` and failed writing (`selection_context_mismatch`). Artifact: `J1-correction.json`.

Write-from-prior publication was fixed on `03310e3`. A new typed correction (`The laptop must have at least 32GB of RAM.` / replace_question refresh) admitted as child `8a8e8774-597c-46f0-9e49-2beb88a438e3` and **published** report `ad28ce8b-3a34-4c6e-9164-ab690a7a8bf0` (`completed_with_limitations`, 22,297 µ, no unknown hold). Artifact: `J1-correction2.json`.

That updated report is not yet a useful 32GB purchase answer: four caveat blocks, empty `claim_ids`, one search, MSI Stealth 16 AI+ at $2,699.99. 32GB RAM was in the owned quote but `quantities_grounded` vetoed it (`at least` qualifier not in quote; grouped `$2,699.99`). Discovery stopped with `no_distinct_public_criterion_query` because every criterion provenance was the full question. Fixes for those two defects follow this run. Audit: `J1-correction2-audit.json`.

Ledger confirmed spend is recorded in `provider_intents` (unknown holds were not retried). One extract identity (`badb7b6e-…`) remains `outcome-unknown` after a 45s deadline abort; it was not retried. Extract deadline is now 90s.

## Not a live Research Beta PASS

A cited parent report and a published 32GB correction exist. The correction body was caveat-only; quantity grounding and distinct constraint queries were fixed after that run. Hosted GitHub Actions is owner-declined. Do not prompt for the laptop password. `main` is not merged.
