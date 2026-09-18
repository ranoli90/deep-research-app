# Provenance-aware retrieval and evidence selection

Requirements W02/W04/W05/W06; Session B lane on `grok-v7/retrieval-evidence`. Canonical behavior is in ENGINE_CONTRACTS and ADR062; this is the change/impact packet.

User outcome: ordinary questions can expand into the right source classes and evidence without leaking private-document terms, and large documents keep headings, table headers, footnotes, exceptions and date/version context with selected anchors. Selection still ranks relevance, not truth. Omitted inventory remains unassessed. `not found` is coverage, not nonexistence.

Impact checklist: new pure research-core policy modules (query provenance/expansion, source-type plan, adaptive breadth, freshness, reconciliation, origin clustering) and backend-owned tables in migration044. No new npm/Python dependency, service, vendor SDK, public action/API schema, provider route, output contract, prompt text, monetary allowance or processor change. Public search still validates model proposals against the original question span; application-derived expansions are added only after that gate. Mixed-document search remains blocked without an explicit `query_authorizations.kind='approved'` row. Source/account deletion purges the new tables.

Atomicity: authorization, freshness, origin links, coverage and reconciliation writes occur in existing account/run/lease-fenced worker transactions. No network I/O in those writes. Search still reserves before HTTP. Concurrent callers serialize under existing locks.

Tests: research-core provenance leak/expansion, source-class change, adaptive stop, held-out selection vs whole-passage.v1, independence clustering, freshness, reconciliation outcomes; real PostgreSQL search-adapter canary/mixed-document/deletion and empty-selection fail-closed. OSS reranker/Docling/OCR/Playwright decisions are recorded, not auto-integrated.

Rollback: stop new discovery admissions if needed. Retain migration044 readers, private-query blocks, inventory veto, empty-selection recovery, deletion and unknown financial holds. Do not adopt neural rerankers or a browser reader by flipping a hidden flag. No cloud migration/deployment is authorized by this packet.
