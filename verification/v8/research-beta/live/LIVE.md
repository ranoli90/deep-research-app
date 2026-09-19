# Live public-web attempt — 2026-09-19

User authorized the OpenRouter key for a **new $2.00 public-web cap** (this file’s `AUTHORIZATION.json`). Isolated DB `deep_v8_live_j12`. MC-D01 21,658 µ hold was **not** released or retried.

Hosted `verification.yml` is still billing-locked. The same steps were run locally (see `../logs/local-verification.tail.txt`). Expo is the Android JS export step, not a substitute for hosted Actions.

## What executed on the production path

Admission → hybrid intent → Azure ZDR brief (`openrouter-azure-mini-zdr-text-v1`) → Azure ZDR web discovery (`public-discovery-azure-zdr.v2`) → source fetch/extract.

Latest useful run `d0b2d2f4-b3ff-4387-9de2-8e3fd10b2272`: 3 search hits, multiple `successful_body` reads, extract+support, counterevidence. Did **not** publish a report (`extraction_invalid_output` on a later pass).

Confirmed new provider cost on this ledger: **72,555 µ ($0.072555)**. Five earlier intents remain `outcome-unknown` (OpenAI `provider_http_404` mis-labeled, plus one search 404); those identities were not retried.

## Not a live Research Beta PASS

A cited published report + correction did not complete. Remaining defect: extract/assert span validation on recovered passages. No merge to `main`.
