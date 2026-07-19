ALTER TABLE migration_exports
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE migration_exports
  ADD CONSTRAINT migration_exports_retry_count_check CHECK (retry_count >= 0);

CREATE INDEX migration_exports_retryable_idx
  ON migration_exports(status, updated_at, id)
  WHERE status IN ('failed', 'canceled');
