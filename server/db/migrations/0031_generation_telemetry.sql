CREATE TABLE IF NOT EXISTS generation_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  client_attempt_id uuid NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  failure_category text,
  result_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generation_telemetry_actor_attempt_unique
    UNIQUE (workspace_id, user_id, client_attempt_id),
  CONSTRAINT generation_telemetry_category_check
    CHECK (category IN ('text', 'image', 'video')),
  CONSTRAINT generation_telemetry_status_check
    CHECK (status IN ('started', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT generation_telemetry_failure_category_check
    CHECK (
      failure_category IS NULL OR failure_category IN (
        'network',
        'authentication',
        'rate_limited',
        'upstream',
        'invalid_response',
        'asset_upload',
        'unknown'
      )
    ),
  CONSTRAINT generation_telemetry_result_count_check
    CHECK (result_count BETWEEN 0 AND 32),
  CONSTRAINT generation_telemetry_duration_check
    CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000),
  CONSTRAINT generation_telemetry_state_check
    CHECK (
      (
        status = 'started'
        AND failure_category IS NULL
        AND result_count = 0
        AND duration_ms IS NULL
        AND completed_at IS NULL
      ) OR (
        status = 'succeeded'
        AND failure_category IS NULL
        AND result_count BETWEEN 1 AND 32
        AND duration_ms IS NOT NULL
        AND completed_at IS NOT NULL
      ) OR (
        status = 'failed'
        AND failure_category IS NOT NULL
        AND result_count = 0
        AND duration_ms IS NOT NULL
        AND completed_at IS NOT NULL
      ) OR (
        status = 'canceled'
        AND failure_category IS NULL
        AND result_count = 0
        AND duration_ms IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),
  CONSTRAINT generation_telemetry_time_order_check
    CHECK (
      updated_at >= created_at
      AND (completed_at IS NULL OR completed_at >= started_at)
    )
);

CREATE INDEX IF NOT EXISTS generation_telemetry_started_at_idx
  ON generation_telemetry (started_at DESC);

CREATE INDEX IF NOT EXISTS generation_telemetry_daily_category_idx
  ON generation_telemetry (started_at DESC, category, status);

CREATE INDEX IF NOT EXISTS generation_telemetry_user_started_idx
  ON generation_telemetry (user_id, started_at DESC);

COMMENT ON TABLE generation_telemetry IS
  'Privacy-minimized browser generation attempt telemetry. This table is not an execution queue and cannot resume, retry, or inspect Provider requests.';

COMMENT ON COLUMN generation_telemetry.client_attempt_id IS
  'Random browser attempt UUID used only for idempotent start-to-terminal updates.';

COMMENT ON COLUMN generation_telemetry.failure_category IS
  'Bounded failure class; Provider error messages and response bodies are prohibited.';
