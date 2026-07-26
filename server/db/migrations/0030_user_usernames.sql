ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS display_username text;

DO $$
DECLARE
  account record;
  base_username text;
  candidate_username text;
  collision_suffix text;
BEGIN
  FOR account IN
    SELECT id, email, user_no, username, display_username
    FROM "user"
    ORDER BY user_no ASC, id ASC
  LOOP
    IF account.username IS NOT NULL AND account.display_username IS NOT NULL THEN
      UPDATE "user"
      SET name = account.display_username
      WHERE id = account.id
        AND name IS DISTINCT FROM account.display_username;
      CONTINUE;
    END IF;

    base_username := lower(
      regexp_replace(split_part(account.email, '@', 1), '[^A-Za-z0-9_]+', '_', 'g')
    );
    base_username := btrim(base_username, '_');

    IF base_username = '' THEN
      base_username := 'user';
    END IF;
    IF base_username !~ '^[a-z]' THEN
      base_username := 'user_' || base_username;
    END IF;
    IF char_length(base_username) < 3 THEN
      base_username := base_username || '_user';
    END IF;

    base_username := left(base_username, 30);
    IF base_username = ANY (
      ARRAY['admin', 'administrator', 'api', 'root', 'support', 'system']
    ) THEN
      base_username := left(base_username, 25) || '_user';
    END IF;

    candidate_username := base_username;
    IF EXISTS (
      SELECT 1 FROM "user" existing
      WHERE existing.id <> account.id
        AND existing.username = candidate_username
    ) THEN
      collision_suffix := '_' || account.user_no::text;
      candidate_username :=
        left(base_username, 30 - char_length(collision_suffix)) || collision_suffix;
    END IF;
    IF EXISTS (
      SELECT 1 FROM "user" existing
      WHERE existing.id <> account.id
        AND existing.username = candidate_username
    ) THEN
      candidate_username := left(base_username, 13) || '_' || substr(md5(account.id), 1, 16);
    END IF;

    UPDATE "user"
    SET username = candidate_username,
        display_username = candidate_username,
        name = candidate_username,
        updated_at = now()
    WHERE id = account.id;
  END LOOP;
END;
$$;

ALTER TABLE "user"
  ALTER COLUMN username SET NOT NULL,
  ALTER COLUMN display_username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_username_unique
  ON "user" (username);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_username_format_check'
      AND conrelid = '"user"'::regclass
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT user_username_format_check CHECK (
        username = lower(username)
        AND username ~ '^[a-z][a-z0-9_]{2,29}$'
        AND username <> ALL (
          ARRAY['admin', 'administrator', 'api', 'root', 'support', 'system']
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_display_username_format_check'
      AND conrelid = '"user"'::regclass
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT user_display_username_format_check CHECK (
        display_username ~ '^[A-Za-z][A-Za-z0-9_]{2,29}$'
        AND lower(display_username) = username
      );
  END IF;
END;
$$;

COMMENT ON COLUMN "user".username IS
  'Immutable lowercase username used for case-insensitive uniqueness and login.';

COMMENT ON COLUMN "user".display_username IS
  'Immutable case-preserving username shown to the user; not a nickname.';

COMMENT ON COLUMN "user".name IS
  'Better Auth compatibility mirror of display_username; not a public profile field.';
