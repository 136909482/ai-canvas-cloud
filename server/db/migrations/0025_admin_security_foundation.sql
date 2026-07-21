CREATE SCHEMA IF NOT EXISTS admin;

REVOKE ALL ON SCHEMA admin FROM PUBLIC;

CREATE TABLE IF NOT EXISTS admin."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT true,
  image text,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_user_email_unique UNIQUE (email),
  CONSTRAINT admin_user_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT admin_user_role_check CHECK (role IN ('super_admin', 'operator', 'support', 'auditor')),
  CONSTRAINT admin_user_status_check CHECK (status IN ('active', 'banned'))
);

CREATE TABLE IF NOT EXISTS admin."session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES admin."user"(id) ON DELETE CASCADE,
  CONSTRAINT admin_session_token_unique UNIQUE (token),
  CONSTRAINT admin_session_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_session_user_id_idx
  ON admin."session"(user_id);

CREATE TABLE IF NOT EXISTS admin."account" (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES admin."user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_account_user_id_idx
  ON admin."account"(user_id);

CREATE TABLE IF NOT EXISTS admin."verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_verification_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_verification_identifier_idx
  ON admin."verification"(identifier);

CREATE TABLE IF NOT EXISTS admin.two_factor (
  id text PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id text NOT NULL REFERENCES admin."user"(id) ON DELETE CASCADE,
  verified boolean NOT NULL DEFAULT false,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  CONSTRAINT admin_two_factor_user_unique UNIQUE (user_id),
  CONSTRAINT admin_two_factor_failed_count_check CHECK (failed_verification_count >= 0)
);

CREATE INDEX IF NOT EXISTS admin_two_factor_secret_idx
  ON admin.two_factor(secret);

CREATE TABLE IF NOT EXISTS admin.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text REFERENCES admin."user"(id),
  admin_role text,
  action text NOT NULL,
  target_type text,
  target_id text,
  result text NOT NULL,
  request_id text NOT NULL,
  ip_hash text,
  user_agent_hash text,
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_role_check CHECK (
    admin_role IS NULL OR admin_role IN ('super_admin', 'operator', 'support', 'auditor')
  ),
  CONSTRAINT admin_audit_result_check CHECK (result IN ('success', 'failure')),
  CONSTRAINT admin_audit_request_id_check CHECK (char_length(request_id) BETWEEN 1 AND 128),
  CONSTRAINT admin_audit_ip_hash_check CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_audit_user_agent_hash_check CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_audit_before_object_check CHECK (jsonb_typeof(before_json) = 'object'),
  CONSTRAINT admin_audit_after_object_check CHECK (jsonb_typeof(after_json) = 'object')
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
  ON admin.audit_events(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_created_idx
  ON admin.audit_events(admin_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin audit events are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_events_append_only ON admin.audit_events;
CREATE TRIGGER admin_audit_events_append_only
BEFORE UPDATE OR DELETE ON admin.audit_events
FOR EACH ROW EXECUTE FUNCTION admin.reject_audit_event_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin FROM PUBLIC;

COMMENT ON SCHEMA admin IS
  'Isolated administrator identity, MFA, session and append-only audit boundary.';
