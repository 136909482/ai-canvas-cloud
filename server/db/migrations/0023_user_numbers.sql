CREATE SEQUENCE user_number_seq
  AS bigint
  START WITH 10001
  INCREMENT BY 1
  MINVALUE 10001
  NO CYCLE;

ALTER TABLE "user"
  ADD COLUMN user_no bigint;

WITH numbered_users AS (
  SELECT
    id,
    10000 + row_number() OVER (ORDER BY created_at ASC, id ASC) AS user_no
  FROM "user"
)
UPDATE "user" AS users
SET user_no = numbered_users.user_no
FROM numbered_users
WHERE numbered_users.id = users.id;

SELECT setval(
  'user_number_seq',
  COALESCE((SELECT max(user_no) FROM "user"), 10001),
  EXISTS (SELECT 1 FROM "user")
);

ALTER TABLE "user"
  ALTER COLUMN user_no SET DEFAULT nextval('user_number_seq'),
  ALTER COLUMN user_no SET NOT NULL,
  ADD CONSTRAINT user_user_no_unique UNIQUE (user_no),
  ADD CONSTRAINT user_user_no_check CHECK (user_no >= 10001);

ALTER SEQUENCE user_number_seq
  OWNED BY "user".user_no;

COMMENT ON COLUMN "user".user_no IS
  'Immutable human-facing user number. Starts at 10001, is never used for authorization, and is never reused.';
