ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS personal_data_purged_at timestamptz;

CREATE TABLE IF NOT EXISTS account_erasure_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id),
  personal_workspace_ids jsonb NOT NULL,
  purge_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_erasure_jobs_user_unique UNIQUE (user_id),
  CONSTRAINT account_erasure_jobs_workspace_ids_array
    CHECK (jsonb_typeof(personal_workspace_ids) = 'array'),
  CONSTRAINT account_erasure_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed')),
  CONSTRAINT account_erasure_jobs_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT account_erasure_jobs_purge_after_check CHECK (purge_after >= created_at),
  CONSTRAINT account_erasure_jobs_completed_state_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS account_erasure_jobs_due_idx
  ON account_erasure_jobs (purge_after, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS user_deleted_at_idx
  ON "user" (deleted_at)
  WHERE status = 'deleted' AND personal_data_purged_at IS NULL;

REVOKE ALL ON account_erasure_jobs FROM PUBLIC;

COMMENT ON TABLE account_erasure_jobs IS
  'Two-phase account erasure work. Immediate account revocation is recorded first; personal workspace rows and private objects are purged after the retention window.';

COMMENT ON COLUMN "user".deleted_at IS
  'The irreversible account revocation timestamp. Deleted user rows are anonymized tombstones retained for foreign-key and immutable audit integrity.';

COMMENT ON COLUMN "user".personal_data_purged_at IS
  'Timestamp when the deferred personal workspace, project history, relation metadata and private object cleanup completed.';
