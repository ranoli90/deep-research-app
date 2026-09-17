ALTER TABLE challenges ADD COLUMN IF NOT EXISTS include_excerpt boolean NOT NULL DEFAULT false;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS excerpt_text text;
