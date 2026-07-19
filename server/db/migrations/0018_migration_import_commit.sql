ALTER TABLE migration_imports
  ADD COLUMN commit_idempotency_key varchar(200),
  ADD COLUMN commit_request_fingerprint char(64),
  ADD COLUMN commit_strategy varchar(16),
  ADD COLUMN committed_project_id uuid,
  ADD COLUMN committed_at timestamptz;

ALTER TABLE migration_imports
  ADD CONSTRAINT migration_imports_commit_key_check CHECK (
    commit_idempotency_key IS NULL OR char_length(btrim(commit_idempotency_key)) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT migration_imports_commit_fingerprint_check CHECK (
    commit_request_fingerprint IS NULL OR commit_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT migration_imports_commit_strategy_check CHECK (
    commit_strategy IS NULL OR commit_strategy IN ('copy', 'replace')
  ),
  ADD CONSTRAINT migration_imports_commit_state_check CHECK (
    (status = 'completed' AND commit_idempotency_key IS NOT NULL AND commit_request_fingerprint IS NOT NULL
      AND commit_strategy IS NOT NULL AND committed_project_id IS NOT NULL AND committed_at IS NOT NULL)
    OR (status <> 'completed' AND committed_at IS NULL)
  );

ALTER TABLE migration_import_asset_uploads
  ADD COLUMN committed_asset_id uuid;

ALTER TABLE migration_import_asset_uploads
  ADD CONSTRAINT migration_import_asset_uploads_committed_asset_fk
    FOREIGN KEY (workspace_id, committed_asset_id)
    REFERENCES assets(workspace_id, id),
  ADD CONSTRAINT migration_import_asset_uploads_committed_state_check CHECK (
    committed_asset_id IS NULL OR status = 'completed'
  );

CREATE INDEX migration_imports_committed_project_idx
  ON migration_imports(workspace_id, committed_project_id)
  WHERE committed_project_id IS NOT NULL;
