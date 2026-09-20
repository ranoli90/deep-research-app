-- ENG-006/009: runtime health is separate from immutable historical request identity.
CREATE TABLE IF NOT EXISTS model_route_health (
 policy_id text PRIMARY KEY,
 state text NOT NULL CHECK (state IN ('healthy','retired')),
 reason text NOT NULL CHECK (reason IN ('registered','operator_retired','provider_route_mismatch')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO model_route_health(policy_id,state,reason) VALUES
 ('openrouter-openai-mini-text-v1','healthy','registered'),
 ('openrouter-azure-mini-zdr-text-v1','healthy','registered'),
 ('openrouter-azure-mini-zdr-exact-quote-v2','healthy','registered'),
 ('openrouter-azure-mini-zdr-discovery-v3','healthy','registered'),
 ('openrouter-openai-mini-strict-v4','healthy','registered'),
 ('openrouter-azure-mini-zdr-strict-v4','healthy','registered') ON CONFLICT (policy_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS model_operation_routes (
 run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 logical_digest text NOT NULL CHECK (logical_digest ~ '^[0-9a-f]{64}$'),
 attempt_index integer NOT NULL CHECK (attempt_index >= 0),
 operation text NOT NULL,
 policy_id text NOT NULL REFERENCES model_route_health(policy_id),
 request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
 reserve_micro bigint NOT NULL CHECK (reserve_micro > 0),
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,logical_digest,attempt_index)
);
DROP TRIGGER IF EXISTS reject_model_operation_route_update ON model_operation_routes;
CREATE TRIGGER reject_model_operation_route_update BEFORE UPDATE ON model_operation_routes
 FOR EACH ROW EXECUTE FUNCTION reject_model_portfolio_resolution_update();
