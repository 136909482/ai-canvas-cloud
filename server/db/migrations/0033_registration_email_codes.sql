CREATE TABLE IF NOT EXISTS registration_email_challenges (
  email_hash text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_email_challenges_email_hash_check
    CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT registration_email_challenges_code_hash_check
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT registration_email_challenges_attempts_check
    CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT registration_email_challenges_time_order_check
    CHECK (expires_at > last_sent_at AND updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS registration_email_challenges_expires_at_idx
  ON registration_email_challenges (expires_at);

ALTER TABLE admin.site_config_revisions
  DROP CONSTRAINT IF EXISTS admin_site_config_schema_version_check;

ALTER TABLE admin.site_config_revisions
  ADD CONSTRAINT admin_site_config_schema_version_check
  CHECK (schema_version IN (1, 2));

REVOKE ALL ON registration_email_challenges FROM PUBLIC;

COMMENT ON TABLE registration_email_challenges IS
  'Short-lived pre-registration email-code challenges. Email and code values are stored only as keyed hashes.';
