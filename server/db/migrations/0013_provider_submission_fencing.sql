ALTER TABLE task_attempts
  ADD COLUMN submission_key text,
  ADD COLUMN submission_stage text NOT NULL DEFAULT 'ready',
  ADD COLUMN remote_task_id text;

UPDATE task_attempts
SET submission_key = 'provider-submission:' || task_id::text
WHERE submission_key IS NULL;

UPDATE task_attempts attempt
SET submission_stage = 'submitted',
    remote_task_id = task.remote_task_id
FROM generation_tasks task
WHERE attempt.task_id = task.id
  AND attempt.attempt_number = task.attempt_count
  AND task.remote_task_id IS NOT NULL;

ALTER TABLE task_attempts
  ALTER COLUMN submission_key SET NOT NULL,
  ADD CONSTRAINT task_attempts_submission_key_check CHECK (
    char_length(submission_key) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT task_attempts_submission_stage_check CHECK (
    submission_stage IN ('ready', 'submitting', 'submitted', 'polling', 'uncertain')
  ),
  ADD CONSTRAINT task_attempts_remote_task_id_check CHECK (
    remote_task_id IS NULL OR char_length(remote_task_id) BETWEEN 1 AND 512
  ),
  ADD CONSTRAINT task_attempts_submission_remote_state_check CHECK (
    (submission_stage IN ('submitted', 'polling') AND remote_task_id IS NOT NULL)
    OR (submission_stage NOT IN ('submitted', 'polling') AND remote_task_id IS NULL)
  );

CREATE INDEX task_attempts_submission_recovery_idx
  ON task_attempts(task_id, submission_stage, attempt_number DESC)
  WHERE submission_stage IN ('submitting', 'submitted', 'polling', 'uncertain');
