CREATE TABLE IF NOT EXISTS source_read_operations (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
 brief_revision integer NOT NULL,
 reader_version text NOT NULL,
 locator text NOT NULL,
 state text NOT NULL CHECK(state IN ('issued','finished')),
 source_version_id uuid REFERENCES source_versions(id) ON DELETE CASCADE,
 UNIQUE(run_id,source_id,brief_revision,reader_version)
);
CREATE INDEX IF NOT EXISTS source_read_owner ON source_read_operations(account_id,run_id);
