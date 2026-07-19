CREATE TABLE generation_task_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  progress smallint NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generation_task_events_id_unique UNIQUE (id),
  CONSTRAINT generation_task_events_workspace_task_fk FOREIGN KEY (workspace_id, task_id)
    REFERENCES generation_tasks(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generation_task_events_workspace_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generation_task_events_type_check CHECK (event_type IN ('created', 'status', 'progress', 'terminal')),
  CONSTRAINT generation_task_events_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT generation_task_events_progress_check CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT generation_task_events_error_code_check CHECK (
    error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 120
  ),
  CONSTRAINT generation_task_events_error_message_check CHECK (
    error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 1000
  )
);

CREATE INDEX generation_task_events_workspace_sequence_idx
  ON generation_task_events(workspace_id, sequence);

CREATE INDEX generation_task_events_workspace_project_sequence_idx
  ON generation_task_events(workspace_id, project_id, sequence);

CREATE INDEX generation_task_events_workspace_task_sequence_idx
  ON generation_task_events(workspace_id, task_id, sequence);

INSERT INTO generation_task_events (
  id, workspace_id, task_id, project_id, event_type, status, progress,
  error_code, error_message, created_at
)
SELECT
  gen_random_uuid(), task.workspace_id, task.id, task.project_id,
  CASE
    WHEN task.status IN ('succeeded', 'failed', 'canceled') THEN 'terminal'
    ELSE 'status'
  END,
  task.status,
  task.progress,
  task.error_code,
  NULLIF(
    left(
      regexp_replace(
        regexp_replace(coalesce(task.error_message, ''), '(https?://)[^[:space:]@/]+@', '\1[redacted]@', 'gi'),
        '(password|authorization|api[_-]?key)[[:space:]]*[:=][^[:space:],;]+', '\1=[redacted]', 'gi'
      ),
      1000
    ),
    ''
  ),
  task.updated_at
FROM generation_tasks task;

CREATE OR REPLACE FUNCTION record_generation_task_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_type_value text;
  safe_error_message text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type_value := 'created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('succeeded', 'failed', 'canceled') THEN
      event_type_value := 'terminal';
    ELSE
      event_type_value := 'status';
    END IF;
  ELSIF NEW.progress IS DISTINCT FROM OLD.progress
     OR NEW.error_code IS DISTINCT FROM OLD.error_code
     OR NEW.error_message IS DISTINCT FROM OLD.error_message THEN
    event_type_value := 'progress';
  ELSE
    RETURN NEW;
  END IF;

  safe_error_message := NULLIF(
    left(
      regexp_replace(
        regexp_replace(coalesce(NEW.error_message, ''), '(https?://)[^[:space:]@/]+@', '\1[redacted]@', 'gi'),
        '(password|authorization|api[_-]?key)[[:space:]]*[:=][^[:space:],;]+', '\1=[redacted]', 'gi'
      ),
      1000
    ),
    ''
  );

  INSERT INTO generation_task_events (
    id, workspace_id, task_id, project_id, event_type, status, progress,
    error_code, error_message
  ) VALUES (
    gen_random_uuid(), NEW.workspace_id, NEW.id, NEW.project_id, event_type_value,
    NEW.status, NEW.progress, NEW.error_code, safe_error_message
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_tasks_record_event_trigger
AFTER INSERT OR UPDATE OF status, progress, error_code, error_message
ON generation_tasks
FOR EACH ROW
EXECUTE FUNCTION record_generation_task_event();
