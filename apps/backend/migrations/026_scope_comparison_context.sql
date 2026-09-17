-- Existing records retain their original writer request representation, including unknown attempts.
ALTER TABLE scope_comparisons ADD COLUMN IF NOT EXISTS writer_context_version text NOT NULL DEFAULT 'scope-comparison.v1';
