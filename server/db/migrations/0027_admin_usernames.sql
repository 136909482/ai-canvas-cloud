ALTER TABLE admin."user"
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS display_username text;

UPDATE admin."user"
SET username = 'admin_' || substr(md5(id), 1, 16)
WHERE username IS NULL;

UPDATE admin."user"
SET display_username = username
WHERE display_username IS NULL;

ALTER TABLE admin."user"
  ALTER COLUMN username SET NOT NULL,
  ALTER COLUMN display_username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_user_username_unique
  ON admin."user"(username);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_user_username_format_check'
      AND conrelid = 'admin."user"'::regclass
  ) THEN
    ALTER TABLE admin."user"
      ADD CONSTRAINT admin_user_username_format_check CHECK (
        username = lower(username)
        AND username ~ '^[a-z0-9_.]{3,30}$'
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_user_display_username_format_check'
      AND conrelid = 'admin."user"'::regclass
  ) THEN
    ALTER TABLE admin."user"
      ADD CONSTRAINT admin_user_display_username_format_check CHECK (
        display_username ~ '^[A-Za-z0-9_.]{3,30}$'
      );
  END IF;
END;
$$;

COMMENT ON COLUMN admin."user".username IS
  'Normalized administrator login identifier. Email remains an internal Better Auth compatibility field.';

COMMENT ON COLUMN admin."user".display_username IS
  'Administrator-facing account label; never used as an ordinary user email identity.';
