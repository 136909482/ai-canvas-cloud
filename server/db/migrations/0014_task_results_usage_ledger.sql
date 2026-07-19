CREATE TABLE usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  provider_id text NOT NULL,
  model_key text NOT NULL,
  billing_mode text NOT NULL,
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_ledger_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT usage_ledger_task_attempt_fk FOREIGN KEY (task_id, attempt_number)
    REFERENCES task_attempts(task_id, attempt_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT usage_ledger_task_unique UNIQUE (task_id),
  CONSTRAINT usage_ledger_attempt_number_positive CHECK (attempt_number BETWEEN 1 AND 20),
  CONSTRAINT usage_ledger_provider_id_check CHECK (char_length(btrim(provider_id)) BETWEEN 1 AND 80),
  CONSTRAINT usage_ledger_model_key_check CHECK (char_length(btrim(model_key)) BETWEEN 1 AND 160),
  CONSTRAINT usage_ledger_billing_mode_check CHECK (billing_mode IN ('workspace_key', 'platform')),
  CONSTRAINT usage_ledger_usage_object_check CHECK (jsonb_typeof(usage_json) = 'object')
);

CREATE INDEX usage_ledger_workspace_created_idx
  ON usage_ledger(workspace_id, created_at DESC, id DESC);
