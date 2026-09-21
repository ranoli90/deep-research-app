# Norrow guest-first authentication and claim

Requirement IDs: Norrow kit GUEST-01–14, CLAIM-01–16, AUTH-01–11, DATA-01–12, COST-01–08, SCALE-01/07, NATIVE-04/05. ADR075 is the protocol authority; the kit chapters 04, 05, 08, 12 and 13 own the detailed product/security requirements.

Goal: permit one consented, sponsored first text/public-URL research submission without registration; require authentication on Send for the second distinct submitted action; after verified Clerk authentication, claim the original conversation and resume the unchanged pending action exactly once. The clarification answer is a second action. Reading, citations, cancellation and deletion remain available to the scoped guest.

Non-goals: anonymous Clerk users, client-only turn counting, email identity merge, broad account aliases, ownership rewrites, free registered allowance, public guest activation, release/deployment, or a second research path.

Affected boundaries: contracts public error/request/response schemas; backend verified identity, guest bootstrap/proof, scope resolver, admission, claim, all resource routes, deletion and worker publication; additive persistence for guest contexts/control bindings/receipts/pending actions; mobile secure guest proof and pending-auth journal. The immutable execution owner continues to own runs, evidence, receipts, sponsor reservations, fences and consent; member control is an explicit conversation binding.

Impact checklist: new Clerk service/SDK and provider configuration; additive migration(s) allocated only under the exclusive migration lock; public schemas; auth, consent, sponsor-budget and deletion behavior; native protected storage. No model/provider route, prompt, processor, hidden paid call, allowance increase, or guest public launch is authorized by this packet. Existing internal account IDs and historical financial identities remain unchanged.

Tests: production request serializers plus independent PostgreSQL clients cover first-admission/idempotency/sponsor races, response loss, claim winner/loser/replay, claim vs expiry/deletion/cancellation/HOLD, every resource route, and post-claim old-proof denial. Mobile tests cover the durable pending envelope, token refresh versus principal/view/control changes, provider cancellation, exact clarification resume and single dispatch. Hosted/native provider journeys remain separate required evidence.

Rollback: default-deny new guest admission and resume while retaining readers for already admitted control bindings, accounting/claim/deletion tombstones, immutable execution records and unknown holds. Do not rewrite owner IDs, erase claims, reactivate proof, or blindly resend an issued operation.
