CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  origin_project_id uuid,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  object_key text NOT NULL,
  original_file_name text,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 text,
  width integer,
  height integer,
  asset_kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT assets_workspace_project_fk FOREIGN KEY (workspace_id, origin_project_id)
    REFERENCES projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT assets_object_key_unique UNIQUE (object_key),
  CONSTRAINT assets_object_key_check CHECK (
    char_length(object_key) BETWEEN 16 AND 512
    AND object_key !~ '[[:space:]]'
    AND object_key !~* '(^|/)[.]{1,2}(/|$)'
  ),
  CONSTRAINT assets_original_file_name_check CHECK (
    original_file_name IS NULL OR char_length(btrim(original_file_name)) BETWEEN 1 AND 255
  ),
  CONSTRAINT assets_mime_type_check CHECK (char_length(btrim(mime_type)) BETWEEN 3 AND 120),
  CONSTRAINT assets_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT assets_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT assets_width_positive CHECK (width IS NULL OR width > 0),
  CONSTRAINT assets_height_positive CHECK (height IS NULL OR height > 0),
  CONSTRAINT assets_asset_kind_check CHECK (asset_kind IN ('upload', 'generated', 'edit', 'crop', 'thumbnail', 'preview', 'video')),
  CONSTRAINT assets_status_check CHECK (status IN ('pending', 'completed', 'failed', 'quarantined', 'deleted')),
  CONSTRAINT assets_deleted_status_check CHECK (deleted_at IS NULL OR status = 'deleted'),
  CONSTRAINT assets_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX assets_workspace_status_updated_idx
  ON assets(workspace_id, status, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX assets_workspace_project_idx
  ON assets(workspace_id, origin_project_id, created_at DESC)
  WHERE deleted_at IS NULL AND origin_project_id IS NOT NULL;

CREATE INDEX assets_workspace_sha256_idx
  ON assets(workspace_id, sha256)
  WHERE sha256 IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE asset_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid,
  asset_id uuid NOT NULL,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  object_key text NOT NULL,
  original_file_name text NOT NULL,
  expected_mime_type text NOT NULL,
  expected_byte_size bigint NOT NULL,
  expected_sha256 text,
  asset_kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_uploads_asset_unique UNIQUE (asset_id),
  CONSTRAINT asset_uploads_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT asset_uploads_workspace_asset_fk FOREIGN KEY (workspace_id, asset_id)
    REFERENCES assets(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asset_uploads_workspace_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asset_uploads_object_key_unique UNIQUE (object_key),
  CONSTRAINT asset_uploads_object_key_check CHECK (
    char_length(object_key) BETWEEN 16 AND 512
    AND object_key !~ '[[:space:]]'
    AND object_key !~* '(^|/)[.]{1,2}(/|$)'
  ),
  CONSTRAINT asset_uploads_file_name_check CHECK (char_length(btrim(original_file_name)) BETWEEN 1 AND 255),
  CONSTRAINT asset_uploads_mime_type_check CHECK (char_length(btrim(expected_mime_type)) BETWEEN 3 AND 120),
  CONSTRAINT asset_uploads_byte_size_positive CHECK (expected_byte_size > 0),
  CONSTRAINT asset_uploads_sha256_check CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT asset_uploads_asset_kind_check CHECK (asset_kind IN ('upload', 'generated', 'edit', 'crop', 'thumbnail', 'preview', 'video')),
  CONSTRAINT asset_uploads_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT asset_uploads_status_check CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  CONSTRAINT asset_uploads_expiry_after_created CHECK (expires_at > created_at),
  CONSTRAINT asset_uploads_completed_status_check CHECK (
    (completed_at IS NULL AND status <> 'completed')
    OR (completed_at IS NOT NULL AND status = 'completed')
  )
);

CREATE INDEX asset_uploads_workspace_pending_expiry_idx
  ON asset_uploads(workspace_id, expires_at, id)
  WHERE status = 'pending';

CREATE TABLE asset_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  asset_id uuid NOT NULL,
  project_id uuid NOT NULL,
  node_id text,
  task_id text,
  reference_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_references_workspace_asset_fk FOREIGN KEY (workspace_id, asset_id)
    REFERENCES assets(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asset_references_workspace_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asset_references_project_node_fk FOREIGN KEY (project_id, node_id)
    REFERENCES project_nodes(project_id, node_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asset_references_target_check CHECK (num_nonnulls(node_id, task_id) = 1),
  CONSTRAINT asset_references_node_id_check CHECK (node_id IS NULL OR char_length(node_id) BETWEEN 1 AND 128),
  CONSTRAINT asset_references_task_id_check CHECK (task_id IS NULL OR char_length(task_id) BETWEEN 1 AND 128),
  CONSTRAINT asset_references_role_check CHECK (
    reference_role IN ('source', 'result', 'thumbnail', 'preview', 'mask', 'attachment')
  )
);

CREATE UNIQUE INDEX asset_references_node_unique_idx
  ON asset_references(workspace_id, asset_id, project_id, node_id, reference_role)
  WHERE node_id IS NOT NULL;

CREATE UNIQUE INDEX asset_references_task_unique_idx
  ON asset_references(workspace_id, asset_id, project_id, task_id, reference_role)
  WHERE task_id IS NOT NULL;

CREATE INDEX asset_references_project_idx
  ON asset_references(workspace_id, project_id, created_at DESC);

CREATE INDEX asset_references_asset_idx
  ON asset_references(workspace_id, asset_id, created_at DESC);
