-- Additive portfolio routing audit. Existing runs keep immutable model_policy_id.
-- Historical request identities are not reinterpreted.

CREATE TABLE IF NOT EXISTS model_portfolio_resolutions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  account_id uuid NOT NULL,
  portfolio_id text NOT NULL,
  operation text NOT NULL,
  resolved_policy_id text NOT NULL,
  admission text NOT NULL,
  escalation_depth integer NOT NULL DEFAULT 0,
  escalation_trigger text,
  cache_session_id text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_portfolio_resolutions_run ON model_portfolio_resolutions (run_id, created_at);

CREATE OR REPLACE FUNCTION reject_model_portfolio_resolution_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model_portfolio_resolution_immutable';
END;
$$;

DROP TRIGGER IF EXISTS reject_model_portfolio_resolution_update ON model_portfolio_resolutions;
CREATE TRIGGER reject_model_portfolio_resolution_update
BEFORE UPDATE ON model_portfolio_resolutions
FOR EACH ROW EXECUTE FUNCTION reject_model_portfolio_resolution_update();
