-- Do not change the behavior or paid identities of already admitted research runs.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS evidence_recovery_policy text NOT NULL DEFAULT 'none.v1';
ALTER TABLE runs ALTER COLUMN evidence_recovery_policy SET DEFAULT 'empty-selection-recovery.v1';
