-- Preserve the exact selected evidence basis, including passages omitted by model output.
-- Historical results remain NULL: their input membership must not be fabricated.
ALTER TABLE model_operation_results ADD COLUMN IF NOT EXISTS input_manifest jsonb;
