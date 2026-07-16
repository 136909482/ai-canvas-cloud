CREATE TABLE generation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  source_node_id text NOT NULL,
  preview_node_id text,
  task_kind text NOT NULL,
  provider_id text NOT NULL,
  model_key text NOT NULL,
  billing_mode text NOT NULL DEFAULT 'workspace_key',
  queue_lane text NOT NULL DEFAULT 'default',
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  progress smallint NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL,
  remote_task_id text,
  error_code text,
  error_message text,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generation_tasks_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT generation_tasks_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT generation_tasks_workspace_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generation_tasks_source_node_fk FOREIGN KEY (project_id, source_node_id)
    REFERENCES project_nodes(project_id, node_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generation_tasks_preview_node_fk FOREIGN KEY (project_id, preview_node_id)
    REFERENCES project_nodes(project_id, node_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generation_tasks_kind_check CHECK (task_kind IN ('image', 'video')),
  CONSTRAINT generation_tasks_provider_id_check CHECK (char_length(btrim(provider_id)) BETWEEN 1 AND 80),
  CONSTRAINT generation_tasks_model_key_check CHECK (char_length(btrim(model_key)) BETWEEN 1 AND 160),
  CONSTRAINT generation_tasks_billing_mode_check CHECK (billing_mode IN ('workspace_key', 'platform')),
  CONSTRAINT generation_tasks_queue_lane_check CHECK (char_length(btrim(queue_lane)) BETWEEN 1 AND 80),
  CONSTRAINT generation_tasks_request_object_check CHECK (jsonb_typeof(request_json) = 'object'),
  CONSTRAINT generation_tasks_result_object_check CHECK (jsonb_typeof(result_json) = 'object'),
  CONSTRAINT generation_tasks_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT generation_tasks_progress_check CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT generation_tasks_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT generation_tasks_max_attempts_positive CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT generation_tasks_attempt_limit_check CHECK (attempt_count <= max_attempts),
  CONSTRAINT generation_tasks_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT generation_tasks_remote_task_id_check CHECK (
    remote_task_id IS NULL OR char_length(remote_task_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT generation_tasks_error_code_check CHECK (
    error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 120
  ),
  CONSTRAINT generation_tasks_error_message_check CHECK (
    error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 1000
  ),
  CONSTRAINT generation_tasks_lease_tuple_check CHECK (
    num_nonnulls(lease_owner, lease_token, lease_expires_at) IN (0, 3)
  ),
  CONSTRAINT generation_tasks_running_lease_check CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND started_at IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL)
  ),
  CONSTRAINT generation_tasks_finished_status_check CHECK (
    (status IN ('succeeded', 'failed', 'canceled') AND finished_at IS NOT NULL)
    OR (status IN ('queued', 'running') AND finished_at IS NULL)
  ),
  CONSTRAINT generation_tasks_canceled_status_check CHECK (
    status = 'canceled' OR cancel_requested_at IS NULL OR status = 'running'
  ),
  CONSTRAINT generation_tasks_available_after_created_check CHECK (available_at >= created_at),
  CONSTRAINT generation_tasks_started_after_created_check CHECK (started_at IS NULL OR started_at >= created_at),
  CONSTRAINT generation_tasks_finished_after_created_check CHECK (finished_at IS NULL OR finished_at >= created_at),
  CONSTRAINT generation_tasks_lease_after_start_check CHECK (
    lease_expires_at IS NULL OR (started_at IS NOT NULL AND lease_expires_at > started_at)
  )
);

CREATE INDEX generation_tasks_workspace_created_idx
  ON generation_tasks(workspace_id, created_at DESC, id DESC);

CREATE INDEX generation_tasks_project_created_idx
  ON generation_tasks(workspace_id, project_id, created_at DESC, id DESC);

CREATE INDEX generation_tasks_queue_claim_idx
  ON generation_tasks(queue_lane, available_at, created_at, id)
  WHERE status = 'queued';

CREATE INDEX generation_tasks_running_lease_idx
  ON generation_tasks(lease_expires_at, id)
  WHERE status = 'running';

CREATE TABLE task_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  provider_id text NOT NULL,
  model_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  remote_request_id text,
  retryable boolean,
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_attempts_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT task_attempts_task_number_unique UNIQUE (task_id, attempt_number),
  CONSTRAINT task_attempts_number_positive CHECK (attempt_number BETWEEN 1 AND 20),
  CONSTRAINT task_attempts_provider_id_check CHECK (char_length(btrim(provider_id)) BETWEEN 1 AND 80),
  CONSTRAINT task_attempts_model_key_check CHECK (char_length(btrim(model_key)) BETWEEN 1 AND 160),
  CONSTRAINT task_attempts_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT task_attempts_remote_request_id_check CHECK (
    remote_request_id IS NULL OR char_length(remote_request_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT task_attempts_usage_object_check CHECK (jsonb_typeof(usage_json) = 'object'),
  CONSTRAINT task_attempts_error_code_check CHECK (
    error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 120
  ),
  CONSTRAINT task_attempts_error_message_check CHECK (
    error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 1000
  ),
  CONSTRAINT task_attempts_finished_status_check CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status IN ('succeeded', 'failed', 'canceled') AND finished_at IS NOT NULL)
  ),
  CONSTRAINT task_attempts_finished_after_started_check CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX task_attempts_workspace_task_idx
  ON task_attempts(workspace_id, task_id, attempt_number DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM asset_references WHERE task_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot add generation task foreign key while legacy task asset references exist';
  END IF;
END
$$;

ALTER TABLE asset_references
  DROP CONSTRAINT asset_references_task_id_check,
  ALTER COLUMN task_id TYPE uuid USING task_id::uuid,
  ADD CONSTRAINT asset_references_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
