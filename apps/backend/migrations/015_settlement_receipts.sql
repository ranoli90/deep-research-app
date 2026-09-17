-- Preserve unknown historical settlements rather than inventing their original charge.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settled_micro bigint;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settlement_basis text;
