CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  last_sequence bigint NOT NULL DEFAULT 0,
  saved_snapshot_id uuid,
  node_count integer NOT NULL DEFAULT 0,
  edge_count integer NOT NULL DEFAULT 0,
  task_count integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT projects_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT projects_version_nonnegative CHECK (version >= 0),
  CONSTRAINT projects_last_sequence_nonnegative CHECK (last_sequence >= 0),
  CONSTRAINT projects_node_count_nonnegative CHECK (node_count >= 0),
  CONSTRAINT projects_edge_count_nonnegative CHECK (edge_count >= 0),
  CONSTRAINT projects_task_count_nonnegative CHECK (task_count >= 0),
  CONSTRAINT projects_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT projects_archived_after_created CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX projects_workspace_active_updated_idx
  ON projects(workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX projects_workspace_archived_updated_idx
  ON projects(workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND archived_at IS NOT NULL;

CREATE TABLE project_nodes (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  width double precision,
  height double precision,
  z_index integer NOT NULL DEFAULT 0,
  parent_node_id text,
  row_version bigint NOT NULL DEFAULT 1,
  data_schema_version integer NOT NULL DEFAULT 1,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  presentation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, node_id),
  CONSTRAINT project_nodes_parent_fk FOREIGN KEY (project_id, parent_node_id)
    REFERENCES project_nodes(project_id, node_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT project_nodes_node_id_check CHECK (char_length(node_id) BETWEEN 1 AND 128),
  CONSTRAINT project_nodes_node_type_check CHECK (char_length(btrim(node_type)) BETWEEN 1 AND 128),
  CONSTRAINT project_nodes_parent_not_self CHECK (parent_node_id IS NULL OR parent_node_id <> node_id),
  CONSTRAINT project_nodes_width_positive CHECK (width IS NULL OR width > 0),
  CONSTRAINT project_nodes_height_positive CHECK (height IS NULL OR height > 0),
  CONSTRAINT project_nodes_row_version_positive CHECK (row_version > 0),
  CONSTRAINT project_nodes_data_schema_version_positive CHECK (data_schema_version > 0),
  CONSTRAINT project_nodes_data_json_object CHECK (jsonb_typeof(data_json) = 'object'),
  CONSTRAINT project_nodes_presentation_json_object CHECK (jsonb_typeof(presentation_json) = 'object')
);

CREATE INDEX project_nodes_project_active_idx
  ON project_nodes(project_id, node_id)
  WHERE deleted_at IS NULL;

CREATE INDEX project_nodes_project_parent_idx
  ON project_nodes(project_id, parent_node_id)
  WHERE deleted_at IS NULL AND parent_node_id IS NOT NULL;

CREATE TABLE project_edges (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  edge_id text NOT NULL,
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  source_handle text,
  target_handle text,
  edge_type text,
  row_version bigint NOT NULL DEFAULT 1,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, edge_id),
  CONSTRAINT project_edges_source_node_fk FOREIGN KEY (project_id, source_node_id)
    REFERENCES project_nodes(project_id, node_id) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT project_edges_target_node_fk FOREIGN KEY (project_id, target_node_id)
    REFERENCES project_nodes(project_id, node_id) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT project_edges_edge_id_check CHECK (char_length(edge_id) BETWEEN 1 AND 128),
  CONSTRAINT project_edges_source_node_id_check CHECK (char_length(source_node_id) BETWEEN 1 AND 128),
  CONSTRAINT project_edges_target_node_id_check CHECK (char_length(target_node_id) BETWEEN 1 AND 128),
  CONSTRAINT project_edges_row_version_positive CHECK (row_version > 0),
  CONSTRAINT project_edges_data_json_object CHECK (jsonb_typeof(data_json) = 'object')
);

CREATE INDEX project_edges_project_active_idx
  ON project_edges(project_id, edge_id)
  WHERE deleted_at IS NULL;

CREATE INDEX project_edges_project_source_idx
  ON project_edges(project_id, source_node_id)
  WHERE deleted_at IS NULL;

CREATE INDEX project_edges_project_target_idx
  ON project_edges(project_id, target_node_id)
  WHERE deleted_at IS NULL;

CREATE TABLE project_changes (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  base_version bigint NOT NULL,
  result_version bigint NOT NULL,
  actor_user_id text REFERENCES "user"(id),
  client_id text,
  batch_id text NOT NULL,
  idempotency_key text NOT NULL,
  source text NOT NULL,
  operations_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sequence),
  CONSTRAINT project_changes_idempotency_unique UNIQUE (project_id, idempotency_key),
  CONSTRAINT project_changes_batch_unique UNIQUE (project_id, batch_id),
  CONSTRAINT project_changes_sequence_positive CHECK (sequence > 0),
  CONSTRAINT project_changes_base_version_nonnegative CHECK (base_version >= 0),
  CONSTRAINT project_changes_result_version_forward CHECK (result_version > base_version),
  CONSTRAINT project_changes_batch_id_check CHECK (char_length(batch_id) BETWEEN 1 AND 160),
  CONSTRAINT project_changes_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT project_changes_source_check CHECK (source IN ('user', 'worker', 'import', 'restore', 'system')),
  CONSTRAINT project_changes_user_actor_check CHECK (source <> 'user' OR actor_user_id IS NOT NULL),
  CONSTRAINT project_changes_operations_array CHECK (jsonb_typeof(operations_json) = 'array')
);

CREATE INDEX project_changes_project_created_idx
  ON project_changes(project_id, created_at DESC);

CREATE TABLE project_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_version bigint NOT NULL,
  last_sequence bigint NOT NULL,
  snapshot_type text NOT NULL,
  schema_version integer NOT NULL,
  record_json jsonb NOT NULL,
  byte_size bigint NOT NULL,
  asset_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_valid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_snapshots_project_version_nonnegative CHECK (project_version >= 0),
  CONSTRAINT project_snapshots_last_sequence_nonnegative CHECK (last_sequence >= 0),
  CONSTRAINT project_snapshots_type_check CHECK (snapshot_type IN ('manual', 'periodic', 'import', 'pre_restore')),
  CONSTRAINT project_snapshots_schema_version_positive CHECK (schema_version > 0),
  CONSTRAINT project_snapshots_record_object CHECK (jsonb_typeof(record_json) = 'object'),
  CONSTRAINT project_snapshots_byte_size_nonnegative CHECK (byte_size >= 0),
  CONSTRAINT project_snapshots_asset_manifest_array CHECK (jsonb_typeof(asset_manifest_json) = 'array')
);

CREATE INDEX project_snapshots_project_version_idx
  ON project_snapshots(project_id, project_version DESC, created_at DESC);

CREATE INDEX project_snapshots_project_valid_sequence_idx
  ON project_snapshots(project_id, last_sequence DESC)
  WHERE is_valid;

ALTER TABLE projects
  ADD CONSTRAINT projects_saved_snapshot_fk FOREIGN KEY (saved_snapshot_id)
    REFERENCES project_snapshots(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE workspace_user_state
  ADD CONSTRAINT workspace_user_state_last_opened_project_fk
    FOREIGN KEY (workspace_id, last_opened_project_id)
    REFERENCES projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT workspace_user_state_active_project_fk
    FOREIGN KEY (workspace_id, active_project_id)
    REFERENCES projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;
