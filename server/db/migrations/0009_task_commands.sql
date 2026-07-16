CREATE TABLE task_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_commands_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT task_commands_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT task_commands_type_check CHECK (command_type IN ('cancel', 'retry')),
  CONSTRAINT task_commands_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
);

CREATE INDEX task_commands_task_created_idx
  ON task_commands(workspace_id, task_id, created_at DESC);
