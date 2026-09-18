-- The existing structured strategy becomes explicit; accepted runs never adopt a new server default.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS research_strategy text NOT NULL DEFAULT 'criterion-adaptive.v1';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runs_research_strategy_valid' AND conrelid='runs'::regclass) THEN
  ALTER TABLE runs ADD CONSTRAINT runs_research_strategy_valid
   CHECK (research_strategy IN ('iterative-baseline.v1','criterion-adaptive.v1'));
 END IF;
END $$;
