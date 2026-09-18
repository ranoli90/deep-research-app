-- Null means legacy/unattributed, not zero spend. Never infer the old key from today's credential.
ALTER TABLE provider_intents ADD COLUMN IF NOT EXISTS provider_key_scope text;
CREATE INDEX IF NOT EXISTS provider_intent_key_budget ON provider_intents(provider_key_scope);
