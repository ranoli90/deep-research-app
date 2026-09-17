-- Additive W02 repair. Old queued/running jobs can be safely redispatched:
-- the worker lease remains the authority for execution, not queue delivery.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS request_digest text;
CREATE TABLE IF NOT EXISTS run_dispatch_outbox (
  run_id uuid PRIMARY KEY REFERENCES runs(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatching','dispatched')),
  attempt_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
INSERT INTO run_dispatch_outbox (run_id)
SELECT id FROM runs WHERE lifecycle IN ('queued','running')
ON CONFLICT (run_id) DO NOTHING;
