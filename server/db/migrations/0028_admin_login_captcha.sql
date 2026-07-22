CREATE TABLE IF NOT EXISTS admin.login_security_settings (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  captcha_enabled boolean NOT NULL DEFAULT false,
  updated_by_admin_id text REFERENCES admin."user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_login_security_settings_singleton_check CHECK (singleton_id = 1)
);

INSERT INTO admin.login_security_settings (singleton_id, captcha_enabled)
VALUES (1, false)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin.login_captcha_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_login_captcha_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_login_captcha_failed_attempts_check CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT admin_login_captcha_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_login_captcha_expiry_idx
  ON admin.login_captcha_challenges(expires_at)
  WHERE consumed_at IS NULL;

REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;

COMMENT ON TABLE admin.login_security_settings IS
  'Singleton administrator login controls; CAPTCHA is disabled by default.';

COMMENT ON TABLE admin.login_captcha_challenges IS
  'Short-lived one-time administrator login CAPTCHA hashes; plaintext codes are never stored.';
