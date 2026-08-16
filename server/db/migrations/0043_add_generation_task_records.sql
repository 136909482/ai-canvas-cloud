-- 用户可见的脱敏生成任务记录。
-- 只保存运营与展示所需的有限摘要（标题、状态、耗时、失败类别、结果数、
-- 模型条目引用、已入云结果资产），不保存 Prompt、endpoint、真实模型 ID、
-- API Key、remote task ID 或上游错误正文；敏感详情留在浏览器加密存储。
CREATE TABLE IF NOT EXISTS public.generation_task_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  client_task_id uuid NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  failure_category text,
  result_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL,
  model_entry_id uuid,
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  started_at timestamp with time zone NOT NULL,
  completed_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT generation_task_records_pkey PRIMARY KEY (id),
  CONSTRAINT generation_task_records_actor_task_unique
    UNIQUE (user_id, client_task_id),
  CONSTRAINT generation_task_records_title_length_check
    CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT generation_task_records_category_check
    CHECK (category IN ('text', 'image', 'video')),
  CONSTRAINT generation_task_records_status_check
    CHECK (status IN ('succeeded', 'failed', 'canceled')),
  CONSTRAINT generation_task_records_failure_category_check
    CHECK (
      failure_category IS NULL
      OR failure_category IN (
        'network', 'authentication', 'rate_limited', 'upstream',
        'invalid_response', 'asset_upload', 'unknown'
      )
    ),
  CONSTRAINT generation_task_records_result_count_check
    CHECK (result_count BETWEEN 0 AND 32),
  CONSTRAINT generation_task_records_duration_check
    CHECK (duration_ms BETWEEN 0 AND 86400000),
  CONSTRAINT generation_task_records_state_check
    CHECK (
      (status = 'failed' AND failure_category IS NOT NULL)
      OR (status <> 'failed' AND failure_category IS NULL)
    ),
  CONSTRAINT generation_task_records_time_order_check
    CHECK (completed_at >= started_at AND updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS generation_task_records_user_completed_idx
  ON public.generation_task_records (user_id, completed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS generation_task_records_workspace_completed_idx
  ON public.generation_task_records (workspace_id, completed_at DESC);

ALTER TABLE ONLY public.generation_task_records
  ADD CONSTRAINT generation_task_records_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public."user" (id) ON DELETE CASCADE;

ALTER TABLE ONLY public.generation_task_records
  ADD CONSTRAINT generation_task_records_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE;

COMMENT ON TABLE public.generation_task_records IS
  'User-visible sanitized generation task records for cross-device history.';
