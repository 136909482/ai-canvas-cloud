-- 官方图片生成、用户积分账户与单次兑换码。
CREATE TABLE IF NOT EXISTS public.user_feature_preferences (
  user_id text PRIMARY KEY REFERENCES public."user" (id) ON DELETE CASCADE,
  official_generation_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_feature_preferences_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS public.official_provider_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  protocol text NOT NULL,
  base_url text NOT NULL,
  credential_envelope jsonb NOT NULL,
  created_by_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_provider_name_length_check CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT official_provider_protocol_check CHECK (protocol IN ('openai-compatible', 'dashscope')),
  CONSTRAINT official_provider_base_url_length_check CHECK (char_length(base_url) BETWEEN 8 AND 2048),
  CONSTRAINT official_provider_credentials_object_check CHECK (jsonb_typeof(credential_envelope) = 'object')
);

CREATE TABLE IF NOT EXISTS public.official_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_revision_id uuid NOT NULL REFERENCES public.official_provider_revisions (id),
  public_name text NOT NULL,
  upstream_model_id text NOT NULL,
  supports_generate boolean NOT NULL DEFAULT true,
  supports_edit boolean NOT NULL DEFAULT false,
  supports_references boolean NOT NULL DEFAULT false,
  price_1k integer,
  price_2k integer,
  price_4k integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_model_name_length_check CHECK (char_length(public_name) BETWEEN 1 AND 120),
  CONSTRAINT official_model_upstream_id_length_check CHECK (char_length(upstream_model_id) BETWEEN 1 AND 256),
  CONSTRAINT official_model_price_1k_check CHECK (price_1k IS NULL OR price_1k BETWEEN 1 AND 1000000),
  CONSTRAINT official_model_price_2k_check CHECK (price_2k IS NULL OR price_2k BETWEEN 1 AND 1000000),
  CONSTRAINT official_model_price_4k_check CHECK (price_4k IS NULL OR price_4k BETWEEN 1 AND 1000000),
  CONSTRAINT official_model_has_price_check CHECK (price_1k IS NOT NULL OR price_2k IS NOT NULL OR price_4k IS NOT NULL),
  CONSTRAINT official_model_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT official_model_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS official_models_status_idx ON public.official_models (status, created_at, id);

CREATE TABLE IF NOT EXISTS public.credit_settings (
  singleton boolean PRIMARY KEY DEFAULT true,
  signup_bonus integer NOT NULL DEFAULT 0,
  signup_bonus_enabled_at timestamptz,
  updated_by_admin_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_settings_singleton_check CHECK (singleton),
  CONSTRAINT credit_settings_bonus_check CHECK (signup_bonus BETWEEN 0 AND 1000000),
  CONSTRAINT credit_settings_enabled_check CHECK (signup_bonus = 0 OR signup_bonus_enabled_at IS NOT NULL)
);

INSERT INTO public.credit_settings (singleton, signup_bonus)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id text PRIMARY KEY REFERENCES public."user" (id) ON DELETE CASCADE,
  available_balance integer NOT NULL DEFAULT 0,
  reserved_balance integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_account_available_check CHECK (available_balance >= 0),
  CONSTRAINT credit_account_reserved_check CHECK (reserved_balance >= 0),
  CONSTRAINT credit_account_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS public.credit_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  available_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  available_balance integer NOT NULL,
  reserved_balance integer NOT NULL,
  reference_type text,
  reference_id text,
  public_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_ledger_type_check CHECK (entry_type IN (
    'signup_bonus', 'redemption', 'admin_adjustment',
    'generation_reserve', 'generation_capture', 'generation_release'
  )),
  CONSTRAINT credit_ledger_delta_check CHECK (available_delta <> 0 OR reserved_delta <> 0),
  CONSTRAINT credit_ledger_available_check CHECK (available_balance >= 0),
  CONSTRAINT credit_ledger_reserved_check CHECK (reserved_balance >= 0),
  CONSTRAINT credit_ledger_reference_check CHECK (
    (reference_type IS NULL AND reference_id IS NULL)
    OR (reference_type IS NOT NULL AND reference_id IS NOT NULL)
  ),
  CONSTRAINT credit_ledger_note_length_check CHECK (public_note IS NULL OR char_length(public_note) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reference_unique
  ON public.credit_ledger_entries (user_id, entry_type, reference_type, reference_id)
  WHERE reference_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON public.credit_ledger_entries (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.redemption_code_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_amount integer NOT NULL,
  code_count integer NOT NULL,
  redeemed_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  note text,
  status text NOT NULL DEFAULT 'active',
  created_by_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redemption_batch_credit_check CHECK (credit_amount BETWEEN 1 AND 1000000),
  CONSTRAINT redemption_batch_count_check CHECK (code_count BETWEEN 1 AND 10000),
  CONSTRAINT redemption_batch_redeemed_check CHECK (redeemed_count BETWEEN 0 AND code_count),
  CONSTRAINT redemption_batch_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT redemption_batch_note_length_check CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  CONSTRAINT redemption_batch_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE IF NOT EXISTS public.redemption_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.redemption_code_batches (id) ON DELETE CASCADE,
  code_digest text NOT NULL UNIQUE,
  code_suffix text NOT NULL,
  redeemed_by_user_id text REFERENCES public."user" (id) ON DELETE SET NULL,
  redeem_idempotency_key text,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redemption_code_digest_length_check CHECK (char_length(code_digest) = 64),
  CONSTRAINT redemption_code_suffix_length_check CHECK (char_length(code_suffix) = 4),
  CONSTRAINT redemption_code_state_check CHECK (
    (redeemed_by_user_id IS NULL AND redeemed_at IS NULL AND redeem_idempotency_key IS NULL)
    OR (redeemed_by_user_id IS NOT NULL AND redeemed_at IS NOT NULL AND redeem_idempotency_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS redemption_codes_batch_idx ON public.redemption_codes (batch_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS redemption_codes_user_idempotency_unique
  ON public.redemption_codes (redeemed_by_user_id, redeem_idempotency_key)
  WHERE redeemed_by_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.official_generation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  client_task_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  model_id uuid NOT NULL REFERENCES public.official_models (id),
  provider_revision_id uuid NOT NULL REFERENCES public.official_provider_revisions (id),
  model_public_name text NOT NULL,
  upstream_model_id text NOT NULL,
  resolution text NOT NULL,
  price integer NOT NULL,
  operation_type text NOT NULL,
  request_envelope jsonb,
  input_asset_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  billing_status text NOT NULL DEFAULT 'reserved',
  failure_category text,
  result_asset_id uuid REFERENCES public.assets (id) ON DELETE SET NULL,
  result_protected_until timestamptz,
  acknowledged_at timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_task_client_unique UNIQUE (user_id, client_task_id),
  CONSTRAINT official_task_idempotency_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT official_task_resolution_check CHECK (resolution IN ('1K', '2K', '4K')),
  CONSTRAINT official_task_price_check CHECK (price BETWEEN 1 AND 1000000),
  CONSTRAINT official_task_operation_check CHECK (operation_type IN ('generate', 'edit')),
  CONSTRAINT official_task_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT official_task_billing_check CHECK (billing_status IN ('reserved', 'captured', 'released')),
  CONSTRAINT official_task_failure_check CHECK (failure_category IS NULL OR failure_category IN (
    'network', 'authentication', 'rate_limited', 'upstream', 'invalid_response',
    'asset_upload', 'configuration', 'worker_interrupted', 'unknown'
  )),
  CONSTRAINT official_task_envelope_check CHECK (request_envelope IS NULL OR jsonb_typeof(request_envelope) = 'object'),
  CONSTRAINT official_task_input_count_check CHECK (cardinality(input_asset_ids) <= 8),
  CONSTRAINT official_task_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS official_tasks_queue_idx
  ON public.official_generation_tasks (created_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS official_tasks_user_created_idx
  ON public.official_generation_tasks (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS official_tasks_protected_asset_idx
  ON public.official_generation_tasks (result_asset_id, result_protected_until)
  WHERE result_asset_id IS NOT NULL AND acknowledged_at IS NULL;

COMMENT ON TABLE public.credit_ledger_entries IS
  'Immutable user credit ledger; account balances are transactionally projected from these entries.';
COMMENT ON TABLE public.official_generation_tasks IS
  'Durable platform-managed image tasks. Sensitive request payloads are encrypted and removed at terminal state.';
