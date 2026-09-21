# Provenance-aware retrieval and evidence selection

Requirements W02/W04/W05/W06; Session B lane on `grok-v7/retrieval-evidence`. Canonical behavior is in ENGINE_CONTRACTS and ADR062; this is the change/impact packet.

User outcome: ordinary questions can expand into the right source classes and evidence without leaking private-document terms, and large documents keep headings, table headers, footnotes, exceptions and date/version context with selected anchors. Selection still ranks relevance, not truth. Omitted inventory remains unassessed. `not found` is coverage, not nonexistence.

Impact checklist: new pure research-core policy modules (query provenance/expansion, source-type plan, adaptive breadth, freshness, reconciliation, origin clustering) and backend-owned tables in migration044. No new npm/Python dependency, service, vendor SDK, public action/API schema, provider route, output contract, prompt text, monetary allowance or processor change. Public search still validates model proposals against the original question span; application-derived expansions are added only after that gate. Mixed-document search remains blocked without an explicit `query_authorizations.kind='approved'` row. Source/account deletion purges the new tables.

Atomicity: authorization, freshness, origin links, coverage and reconciliation writes occur in existing account/run/lease-fenced worker transactions. No network I/O in those writes. Search still reserves before HTTP. Concurrent callers serialize under existing locks.

Tests: research-core provenance leak/expansion, source-class change, adaptive stop, held-out selection vs whole-passage.v1, independence clustering, freshness, reconciliation outcomes; real PostgreSQL search-adapter canary/mixed-document/deletion and empty-selection fail-closed. OSS reranker/Docling/OCR/Playwright decisions are recorded, not auto-integrated.

Rollback: stop new discovery admissions if needed. Retain migration044 readers, private-query blocks, inventory veto, empty-selection recovery, deletion and unknown financial holds. Do not adopt neural rerankers or a browser reader by flipping a hidden flag. No cloud migration/deployment is authorized by this packet.

## Phase A Wave D (ENG-011–021)

Durable retrieval recovery and source policy. Migration `049_retrieval_recovery.sql` adds `research_iteration_actions`, `source_policy_exclusions`, source-read `unknown`/`failed`, and optional `effective_date`/`applicable_version`. New reads use `source-read.v2` and restore v1 identities first. Adapter failures degrade per source; lease/cancel/ownership stay fatal. Continuation refreshes spent plus issued/unknown reserves. `prefer_primary` ranks curated vendor/standards/project hosts and admits secondaries; `primary_only` is exclusion. Canonical URL identity strips tracking/fragments/default ports. Redirect policy is re-checked before storing bytes. Unknown required dates/versions stay unmet and must be disclosed at publication. Stored-source strategy loads the best authorized version.

Impact: internal recovery/evidence membership and optional source metadata only. No new dependency, service, model, processor, prompt, or paid allowance. Rollback disables new scheduling; keep historical v1/v2 readers, source versions, deletion, exclusion gates, and financial holds.

## RES-02 / RES-03 / RES-05 freshness and semantic coverage

New freshness writes use `criterion-freshness.v4`; persisted v2/v3 identities remain immutable and resume under their stored meaning. v4 classifies each requested fact: explicit-now and natural present-tense workforce facts remain current beside a historical founding fact, while fixed-date/as-of facts stay historical. The historical stop/read shortcut requires a structurally atomic task. A shared criterion covering coordinated entities cannot be satisfied by evidence for only one entity, so its unresolved key remains connected to production Evidence Needs and limited-publication disclosure.

Impact checklist: no new dependency, service, migration, public schema, model prompt, provider route, processor, consent rule, or paid allowance. Existing policy rows change from overwrite-on-resume to insert-once plus validated owner-scoped restore. Rollback may stop new v4 assignment, but must retain v4 readers and admitted rows together with consent, cancellation, budget, deletion and publication fences.
