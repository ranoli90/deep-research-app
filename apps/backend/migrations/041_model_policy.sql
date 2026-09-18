-- Existing and unspecified runs retain exact legacy provider/request identities.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS model_policy_id text NOT NULL DEFAULT 'openrouter-openai-mini-text-v1';

CREATE OR REPLACE FUNCTION preserve_run_model_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.model_policy_id IS DISTINCT FROM OLD.model_policy_id THEN
  RAISE EXCEPTION 'model_policy_immutable';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_run_model_policy ON runs;
CREATE TRIGGER preserve_run_model_policy BEFORE UPDATE OF model_policy_id ON runs
FOR EACH ROW EXECUTE FUNCTION preserve_run_model_policy();
