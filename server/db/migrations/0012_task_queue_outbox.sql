CREATE TABLE task_queue_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  dispatch_kind text NOT NULL DEFAULT 'run',
  dispatch_key text NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempt_count integer NOT NULL DEFAULT 0,
  claim_owner text,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_queue_outbox_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT task_queue_outbox_workspace_dispatch_key_unique UNIQUE (workspace_id, dispatch_key),
  CONSTRAINT task_queue_outbox_dispatch_kind_check CHECK (dispatch_kind = 'run'),
  CONSTRAINT task_queue_outbox_dispatch_key_check CHECK (char_length(dispatch_key) BETWEEN 1 AND 200),
  CONSTRAINT task_queue_outbox_attempt_count_nonnegative CHECK (publish_attempt_count >= 0),
  CONSTRAINT task_queue_outbox_claim_tuple_check CHECK (
    num_nonnulls(claim_owner, claim_token, claim_expires_at) IN (0, 3)
  ),
  CONSTRAINT task_queue_outbox_last_error_check CHECK (
    last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 1000
  ),
  CONSTRAINT task_queue_outbox_available_after_created_check CHECK (available_at >= created_at),
  CONSTRAINT task_queue_outbox_published_after_created_check CHECK (
    published_at IS NULL OR published_at >= created_at
  )
);

CREATE INDEX task_queue_outbox_pending_idx
  ON task_queue_outbox(available_at, created_at, id)
  WHERE published_at IS NULL;

CREATE INDEX task_queue_outbox_task_idx
  ON task_queue_outbox(workspace_id, task_id, created_at DESC);

INSERT INTO task_queue_outbox (
  workspace_id, task_id, dispatch_kind, dispatch_key, available_at
)
SELECT
  workspace_id,
  id,
  'run',
  'run:' || id::text || ':' || (attempt_count + 1)::text,
  GREATEST(available_at, now())
FROM generation_tasks
WHERE status = 'queued';
