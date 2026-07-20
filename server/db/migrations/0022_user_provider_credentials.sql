ALTER TABLE provider_credentials
  ADD COLUMN user_id text REFERENCES "user"(id);

UPDATE provider_credentials
SET user_id = created_by_user_id
WHERE user_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM provider_credentials
    GROUP BY user_id, provider_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'provider credential migration requires duplicate user/provider repair';
  END IF;
END
$$;

ALTER TABLE provider_credentials
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN workspace_id DROP NOT NULL,
  DROP CONSTRAINT provider_credentials_workspace_provider_unique,
  ADD CONSTRAINT provider_credentials_user_provider_unique UNIQUE (user_id, provider_id);

DROP INDEX provider_credentials_workspace_status_idx;

CREATE INDEX provider_credentials_user_status_idx
  ON provider_credentials(user_id, status, provider_id);

COMMENT ON COLUMN provider_credentials.workspace_id IS
  'Legacy encryption scope for credentials written before 0022; NULL for user-scoped credentials.';
