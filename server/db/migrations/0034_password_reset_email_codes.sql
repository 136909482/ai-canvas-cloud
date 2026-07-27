CREATE TABLE IF NOT EXISTS password_reset_email_challenges (
  email_hash text PRIMARY KEY,
  code_hash text NOT NULL,
  reset_token_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_email_challenges_email_hash_check
    CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_reset_email_challenges_code_hash_check
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_reset_email_challenges_ciphertext_check
    CHECK (reset_token_ciphertext ~ '^[A-Za-z0-9_-]{40,}$'),
  CONSTRAINT password_reset_email_challenges_attempts_check
    CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT password_reset_email_challenges_time_order_check
    CHECK (expires_at > last_sent_at AND updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS password_reset_email_challenges_expires_at_idx
  ON password_reset_email_challenges (expires_at);

REVOKE ALL ON password_reset_email_challenges FROM PUBLIC;

COMMENT ON TABLE password_reset_email_challenges IS
  'Short-lived password-reset email-code challenges. Email and code values are keyed hashes; Better Auth reset tokens are AES-256-GCM ciphertext.';
