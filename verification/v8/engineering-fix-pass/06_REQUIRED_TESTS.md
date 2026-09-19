# Required test additions

## Revision/state
- clarification leaves original question byte-identical in DB column and payload
- confirmed constraint reaches brief model separately
- assumption replacement creates revisioned research state
- stale assumption/steering request 409s
- wrong awaiting-input type/id cannot resume run

## Provider/cost
- primary transient → fallback success → persist → replay
- primary transient → fallback unknown → crash → replay, zero resend
- 404 known-zero vs known-unknown vs transport-unknown settlement
- invalid_output with unknown cost cannot repair
- reserve >= configured worst-case request price

## Query privacy
- unknown model-invented term blocked
- exact approval cannot be reused for another query
- approval clears pending and is idempotent
- concurrent approval/revision change
- approved private counterevidence query only

## Retrieval
- Azure ZDR new-search max results version
- worker crash after query/read reconstructs exact controller state
- full-text read is readable
- one degradable source exception + two valid reads
- final redirect violates source policy
- prefer_primary falls back to secondary when primary insufficient
- direct URL actually read
- freshness unknown remains unmet

## Intelligence
- Evidence Need lifecycle survives restart
- candidate exclusion/reopen after budget correction
- candidate completeness cannot be caller-asserted
- two consequential conclusions create two challenge obligations
- document/web semantic reconciliation scope/number/date/negation

## Publication
- missing support assessment never synthesized as supported
- partial coverage review cannot fabricate missing supported question
- limited report missing one critical unresolved disclosure rejected
- historical prior-evidence report blocked if later evidence could affect same criterion
- arithmetic path variants all green

## API/mobile
- mobile uses typed activity DTO only
- raw private/public summary absent from client response
- approved query permission disappears after approval/cold reopen
- deleted token cannot read endpoints
- strict malformed request tests
- missing live-run idempotency header rejected
- physical keyboard send accessible

## Regression
- full PG from a fresh database twice at exact final SHA
- no timeout increases unless measured performance cause and explicit justification
