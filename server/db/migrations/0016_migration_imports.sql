CREATE TABLE migration_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_by_user_id text NOT NULL,
  package_schema_version integer NOT NULL,
  package_id varchar(128) NOT NULL,
  source_platform varchar(32) NOT NULL,
  source_project_id varchar(128) NOT NULL,
  source_project_version bigint NOT NULL,
  source_project_sequence bigint NOT NULL,
  project_name varchar(160) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  content_sha256 char(64) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'prepared',
  conflict_type varchar(32) NOT NULL DEFAULT 'none',
  target_project_id uuid,
  target_project_name varchar(160),
  target_expected_version bigint,
  target_expected_sequence bigint,
  target_archived_at timestamptz,
  asset_count integer NOT NULL,
  total_file_count integer NOT NULL,
  completed_file_count integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL,
  completed_bytes bigint NOT NULL DEFAULT 0,
  estimated_storage_bytes bigint NOT NULL,
  available_bytes_at_prepare bigint NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  error_code varchar(80),
  error_message varchar(500),
  manifest_json jsonb NOT NULL,
  project_record_json jsonb NOT NULL,
  graph_json jsonb NOT NULL,
  asset_manifest_json jsonb NOT NULL,
  checkpoint_json jsonb,
  cancel_requested_at timestamptz,
  canceled_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_imports_workspace_creator_fk
    FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_members(workspace_id, user_id),
  CONSTRAINT migration_imports_target_project_fk
    FOREIGN KEY (workspace_id, target_project_id)
    REFERENCES projects(workspace_id, id),
  CONSTRAINT migration_imports_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT migration_imports_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT migration_imports_package_schema_check CHECK (package_schema_version = 1),
  CONSTRAINT migration_imports_source_platform_check CHECK (source_platform IN ('web', 'electron', 'cloud')),
  CONSTRAINT migration_imports_status_check CHECK (status IN (
    'prepared', 'uploading', 'validating', 'ready', 'committing',
    'completed', 'failed', 'canceled', 'expired'
  )),
  CONSTRAINT migration_imports_conflict_type_check CHECK (conflict_type IN (
    'none', 'project_exists', 'project_id_unavailable', 'source_id_incompatible'
  )),
  CONSTRAINT migration_imports_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_imports_content_sha256_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_imports_package_id_check CHECK (char_length(btrim(package_id)) BETWEEN 1 AND 128),
  CONSTRAINT migration_imports_source_project_id_check CHECK (char_length(btrim(source_project_id)) BETWEEN 1 AND 128),
  CONSTRAINT migration_imports_project_name_check CHECK (char_length(btrim(project_name)) BETWEEN 1 AND 160),
  CONSTRAINT migration_imports_idempotency_key_check CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT migration_imports_versions_nonnegative CHECK (
    source_project_version >= 0
    AND source_project_sequence >= 0
    AND (target_expected_version IS NULL OR target_expected_version >= 0)
    AND (target_expected_sequence IS NULL OR target_expected_sequence >= 0)
  ),
  CONSTRAINT migration_imports_counts_nonnegative CHECK (
    asset_count >= 0
    AND total_file_count >= 0
    AND completed_file_count >= 0
    AND completed_file_count <= total_file_count
    AND retry_count >= 0
  ),
  CONSTRAINT migration_imports_bytes_nonnegative CHECK (
    total_bytes >= 0
    AND completed_bytes >= 0
    AND completed_bytes <= total_bytes
    AND estimated_storage_bytes >= 0
    AND available_bytes_at_prepare >= 0
  ),
  CONSTRAINT migration_imports_conflict_target_check CHECK (
    (
      conflict_type = 'project_exists'
      AND target_project_id IS NOT NULL
      AND target_project_name IS NOT NULL
      AND target_expected_version IS NOT NULL
      AND target_expected_sequence IS NOT NULL
    ) OR (
      conflict_type <> 'project_exists'
      AND target_project_id IS NULL
      AND target_project_name IS NULL
      AND target_expected_version IS NULL
      AND target_expected_sequence IS NULL
      AND target_archived_at IS NULL
    )
  ),
  CONSTRAINT migration_imports_error_state_check CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
  ),
  CONSTRAINT migration_imports_canceled_state_check CHECK (
    (status = 'canceled' AND canceled_at IS NOT NULL)
    OR (status <> 'canceled' AND canceled_at IS NULL)
  ),
  CONSTRAINT migration_imports_completed_state_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT migration_imports_manifest_object_check CHECK (jsonb_typeof(manifest_json) = 'object'),
  CONSTRAINT migration_imports_project_record_object_check CHECK (jsonb_typeof(project_record_json) = 'object'),
  CONSTRAINT migration_imports_graph_object_check CHECK (jsonb_typeof(graph_json) = 'object'),
  CONSTRAINT migration_imports_asset_manifest_object_check CHECK (jsonb_typeof(asset_manifest_json) = 'object'),
  CONSTRAINT migration_imports_checkpoint_object_check CHECK (
    checkpoint_json IS NULL OR jsonb_typeof(checkpoint_json) = 'object'
  ),
  CONSTRAINT migration_imports_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT migration_imports_updated_check CHECK (updated_at >= created_at)
);

CREATE INDEX migration_imports_workspace_status_updated_idx
  ON migration_imports(workspace_id, status, updated_at DESC, id DESC);

CREATE INDEX migration_imports_expiry_idx
  ON migration_imports(expires_at, id)
  WHERE status IN ('prepared', 'uploading', 'validating', 'ready');
