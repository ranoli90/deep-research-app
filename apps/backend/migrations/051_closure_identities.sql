-- CL-01/CL-07: persist the typed pending clarification field and hierarchical draft composition.
-- Additive only. Historical awaiting_input rows keep NULL field; historical drafts keep NULL composition.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS pending_input_field text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pending_input_field_known') THEN
    ALTER TABLE runs ADD CONSTRAINT pending_input_field_known CHECK (
      pending_input_field IS NULL OR pending_input_field IN (
        'geography','budget','use_case','population','timeframe','platform','private_search','subject','currency','safety'
      )
    ) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pending_input_field_type') THEN
    ALTER TABLE runs ADD CONSTRAINT pending_input_field_type CHECK (
      pending_input_field IS NULL OR pending_input_type = 'clarification'
    ) NOT VALID;
  END IF;
END $$;

ALTER TABLE research_drafts ADD COLUMN IF NOT EXISTS composition jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='research_drafts_composition_object') THEN
    ALTER TABLE research_drafts ADD CONSTRAINT research_drafts_composition_object CHECK (
      composition IS NULL OR jsonb_typeof(composition) = 'object'
    ) NOT VALID;
  END IF;
END $$;
