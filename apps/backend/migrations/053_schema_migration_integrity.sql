-- Operator-owned migration source identity. Historical rows predate source
-- receipts and are explicitly marked as a current-file baseline, not proof
-- of the bytes that originally ran.
CREATE TABLE schema_migration_sources (
  migration_id text PRIMARY KEY REFERENCES schema_migrations(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  provenance text NOT NULL CHECK (provenance IN ('applied_with_checksum', 'legacy_current_file_baseline')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
