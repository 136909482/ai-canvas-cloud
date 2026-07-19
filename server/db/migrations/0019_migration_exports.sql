CREATE TABLE migration_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_by_user_id text NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'prepared',
  project_name text NOT NULL,
  project_version bigint NOT NULL,
  project_sequence bigint NOT NULL,
  file_count integer NOT NULL,
  completed_file_count integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL,
  completed_bytes bigint NOT NULL DEFAULT 0,
  manifest_json jsonb NOT NULL,
  project_record_json jsonb NOT NULL,
  graph_json jsonb NOT NULL,
  asset_manifest_json jsonb NOT NULL,
  checkpoint_json jsonb,
  export_assets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  archive_object_key text,
  archive_byte_size bigint,
  archive_sha256 char(64),
  error_code varchar(80),
  error_message text,
  cancel_requested_at timestamptz,
  canceled_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_exports_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT migration_exports_workspace_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT migration_exports_creator_fk FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_members(workspace_id, user_id),
  CONSTRAINT migration_exports_idempotency_key_check CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT migration_exports_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_exports_status_check CHECK (status IN ('prepared', 'generating', 'completed', 'failed', 'canceled', 'expired')),
  CONSTRAINT migration_exports_versions_nonnegative CHECK (project_version >= 0 AND project_sequence >= 0),
  CONSTRAINT migration_exports_counts_nonnegative CHECK (
    file_count >= 1 AND completed_file_count >= 0 AND completed_file_count <= file_count
    AND total_bytes >= 0 AND completed_bytes >= 0 AND completed_bytes <= total_bytes
  ),
  CONSTRAINT migration_exports_payload_object_check CHECK (
    jsonb_typeof(manifest_json) = 'object'
    AND jsonb_typeof(project_record_json) = 'object'
    AND jsonb_typeof(graph_json) = 'object'
    AND jsonb_typeof(asset_manifest_json) = 'object'
    AND jsonb_typeof(export_assets_json) = 'array'
    AND (checkpoint_json IS NULL OR jsonb_typeof(checkpoint_json) = 'object')
  ),
  CONSTRAINT migration_exports_archive_sha256_check CHECK (archive_sha256 IS NULL OR archive_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_exports_archive_state_check CHECK (
    (status = 'completed' AND archive_object_key IS NOT NULL AND archive_byte_size IS NOT NULL
      AND archive_sha256 IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT migration_exports_error_state_check CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' OR (error_code IS NOT NULL AND error_message IS NOT NULL))
  ),
  CONSTRAINT migration_exports_terminal_time_check CHECK (
    canceled_at IS NULL OR status = 'canceled'
  )
);

CREATE INDEX migration_exports_workspace_status_updated_idx
  ON migration_exports(workspace_id, status, updated_at DESC, id DESC);

CREATE INDEX migration_exports_expiry_idx
  ON migration_exports(expires_at, id)
  WHERE status IN ('prepared', 'generating', 'failed');
