CREATE TABLE migration_import_asset_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  import_id uuid NOT NULL,
  logical_asset_id varchar(128) NOT NULL,
  object_key text NOT NULL,
  provider_upload_id text,
  upload_mode varchar(16) NOT NULL,
  part_size bigint NOT NULL,
  part_count integer NOT NULL,
  completed_parts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_file_path varchar(512) NOT NULL,
  expected_original_file_name varchar(255),
  expected_mime_type varchar(120) NOT NULL,
  expected_byte_size bigint NOT NULL,
  expected_sha256 char(64) NOT NULL,
  expected_width integer,
  expected_height integer,
  expected_asset_kind varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  uploaded_byte_size bigint NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  error_code varchar(80),
  error_message varchar(500),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_import_asset_uploads_workspace_import_fk
    FOREIGN KEY (workspace_id, import_id)
    REFERENCES migration_imports(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT migration_import_asset_uploads_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT migration_import_asset_uploads_logical_unique UNIQUE (workspace_id, import_id, logical_asset_id),
  CONSTRAINT migration_import_asset_uploads_object_key_unique UNIQUE (object_key),
  CONSTRAINT migration_import_asset_uploads_logical_id_check CHECK (
    logical_asset_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT migration_import_asset_uploads_object_key_check CHECK (
    char_length(object_key) BETWEEN 16 AND 512
    AND object_key !~ '[[:space:]]'
    AND object_key !~* '(^|/)[.]{1,2}(/|$)'
    AND object_key LIKE 'workspaces/%/migration-imports/%'
  ),
  CONSTRAINT migration_import_asset_uploads_provider_id_check CHECK (
    provider_upload_id IS NULL OR char_length(provider_upload_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT migration_import_asset_uploads_mode_check CHECK (upload_mode IN ('single', 'multipart')),
  CONSTRAINT migration_import_asset_uploads_part_size_check CHECK (part_size > 0),
  CONSTRAINT migration_import_asset_uploads_part_count_check CHECK (part_count BETWEEN 1 AND 10000),
  CONSTRAINT migration_import_asset_uploads_mode_parts_check CHECK (
    (upload_mode = 'single' AND provider_upload_id IS NULL AND part_count = 1)
    OR (upload_mode = 'multipart' AND provider_upload_id IS NOT NULL AND part_count > 1)
  ),
  CONSTRAINT migration_import_asset_uploads_completed_parts_json_check CHECK (
    jsonb_typeof(completed_parts_json) = 'array'
  ),
  CONSTRAINT migration_import_asset_uploads_file_path_check CHECK (
    char_length(btrim(expected_file_path)) BETWEEN 1 AND 512
  ),
  CONSTRAINT migration_import_asset_uploads_file_name_check CHECK (
    expected_original_file_name IS NULL
    OR char_length(btrim(expected_original_file_name)) BETWEEN 1 AND 255
  ),
  CONSTRAINT migration_import_asset_uploads_mime_check CHECK (
    char_length(btrim(expected_mime_type)) BETWEEN 3 AND 120
  ),
  CONSTRAINT migration_import_asset_uploads_byte_size_check CHECK (
    expected_byte_size > 0
    AND uploaded_byte_size >= 0
    AND uploaded_byte_size <= expected_byte_size
  ),
  CONSTRAINT migration_import_asset_uploads_sha256_check CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT migration_import_asset_uploads_dimensions_check CHECK (
    (expected_width IS NULL AND expected_height IS NULL)
    OR (expected_width > 0 AND expected_height > 0)
  ),
  CONSTRAINT migration_import_asset_uploads_asset_kind_check CHECK (
    expected_asset_kind IN ('upload', 'generated', 'edit', 'crop', 'thumbnail', 'preview', 'video')
  ),
  CONSTRAINT migration_import_asset_uploads_status_check CHECK (status IN (
    'pending', 'uploading', 'validating', 'completed', 'failed', 'canceled', 'expired'
  )),
  CONSTRAINT migration_import_asset_uploads_counts_check CHECK (retry_count >= 0),
  CONSTRAINT migration_import_asset_uploads_error_state_check CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
  ),
  CONSTRAINT migration_import_asset_uploads_completed_state_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT migration_import_asset_uploads_canceled_state_check CHECK (
    (status = 'canceled' AND canceled_at IS NOT NULL)
    OR (status <> 'canceled' AND canceled_at IS NULL)
  ),
  CONSTRAINT migration_import_asset_uploads_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT migration_import_asset_uploads_updated_check CHECK (updated_at >= created_at)
);

CREATE INDEX migration_import_asset_uploads_import_status_idx
  ON migration_import_asset_uploads(workspace_id, import_id, status, updated_at DESC, id DESC);

CREATE INDEX migration_import_asset_uploads_expiry_idx
  ON migration_import_asset_uploads(expires_at, id)
  WHERE status IN ('pending', 'uploading', 'validating');
