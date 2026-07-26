CREATE TABLE IF NOT EXISTS admin.smtp_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL,
  host text NOT NULL,
  port integer NOT NULL,
  security_mode text NOT NULL,
  username text NOT NULL,
  encrypted_password_json jsonb NOT NULL,
  key_version integer NOT NULL,
  from_email text NOT NULL,
  from_name text NOT NULL,
  created_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_smtp_config_host_check CHECK (char_length(host) BETWEEN 1 AND 253),
  CONSTRAINT admin_smtp_config_port_check CHECK (port IN (25, 465, 587, 2525)),
  CONSTRAINT admin_smtp_config_security_check CHECK (security_mode IN ('implicit_tls', 'starttls')),
  CONSTRAINT admin_smtp_config_username_check CHECK (char_length(username) BETWEEN 1 AND 320),
  CONSTRAINT admin_smtp_config_from_email_check CHECK (char_length(from_email) BETWEEN 3 AND 320),
  CONSTRAINT admin_smtp_config_from_name_check CHECK (char_length(from_name) BETWEEN 1 AND 100),
  CONSTRAINT admin_smtp_config_key_version_check CHECK (key_version > 0),
  CONSTRAINT admin_smtp_config_envelope_check CHECK (
    jsonb_typeof(encrypted_password_json) = 'object'
    AND encrypted_password_json ?& ARRAY['algorithm', 'keyVersion', 'iv', 'ciphertext', 'authTag']
    AND encrypted_password_json ->> 'algorithm' = 'aes-256-gcm'
    AND (encrypted_password_json ->> 'keyVersion')::integer = key_version
  )
);

CREATE TABLE IF NOT EXISTS admin.smtp_config_current (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL UNIQUE REFERENCES admin.smtp_config_revisions(id),
  updated_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_smtp_config_current_singleton_check CHECK (singleton_id = 1)
);

CREATE TABLE IF NOT EXISTS public.smtp_config_publications (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL,
  enabled boolean NOT NULL,
  host text NOT NULL,
  port integer NOT NULL,
  security_mode text NOT NULL,
  username text NOT NULL,
  encrypted_password_json jsonb NOT NULL,
  key_version integer NOT NULL,
  from_email text NOT NULL,
  from_name text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smtp_config_publications_singleton_check CHECK (singleton_id = 1),
  CONSTRAINT smtp_config_publications_port_check CHECK (port IN (25, 465, 587, 2525)),
  CONSTRAINT smtp_config_publications_security_check CHECK (security_mode IN ('implicit_tls', 'starttls')),
  CONSTRAINT smtp_config_publications_key_version_check CHECK (key_version > 0),
  CONSTRAINT smtp_config_publications_envelope_check CHECK (
    jsonb_typeof(encrypted_password_json) = 'object'
    AND encrypted_password_json ?& ARRAY['algorithm', 'keyVersion', 'iv', 'ciphertext', 'authTag']
    AND encrypted_password_json ->> 'algorithm' = 'aes-256-gcm'
    AND (encrypted_password_json ->> 'keyVersion')::integer = key_version
  )
);

CREATE TABLE IF NOT EXISTS admin.smtp_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text NOT NULL REFERENCES admin."user"(id),
  test_kind text NOT NULL,
  result text NOT NULL DEFAULT 'pending',
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT admin_smtp_test_kind_check CHECK (test_kind IN ('connection', 'email')),
  CONSTRAINT admin_smtp_test_result_check CHECK (result IN ('pending', 'success', 'failure')),
  CONSTRAINT admin_smtp_test_completion_check CHECK (
    (result = 'pending' AND completed_at IS NULL)
    OR (result IN ('success', 'failure') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_smtp_test_attempts_admin_created_idx
  ON admin.smtp_test_attempts(admin_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin.reject_smtp_config_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SMTP configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_smtp_config_revisions_immutable ON admin.smtp_config_revisions;
CREATE TRIGGER admin_smtp_config_revisions_immutable
BEFORE UPDATE OR DELETE ON admin.smtp_config_revisions
FOR EACH ROW EXECUTE FUNCTION admin.reject_smtp_config_revision_mutation();

REVOKE ALL ON public.smtp_config_publications FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin FROM PUBLIC;

COMMENT ON TABLE admin.smtp_config_revisions IS
  'Immutable administrator-managed SMTP revisions; passwords are AES-256-GCM ciphertext.';
COMMENT ON TABLE public.smtp_config_publications IS
  'Active encrypted SMTP publication readable only by the ordinary API role.';
COMMENT ON TABLE admin.smtp_test_attempts IS
  'Bounded administrator SMTP test limiter and outcome metadata without recipients or credentials.';
