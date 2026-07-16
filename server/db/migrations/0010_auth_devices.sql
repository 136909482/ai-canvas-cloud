CREATE TABLE auth_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  device_key text NOT NULL,
  user_agent text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_session_id text REFERENCES "session"(id) ON DELETE SET NULL,
  CONSTRAINT auth_devices_user_device_unique UNIQUE (user_id, device_key),
  CONSTRAINT auth_devices_device_key_check CHECK (char_length(device_key) BETWEEN 1 AND 128),
  CONSTRAINT auth_devices_user_agent_check CHECK (user_agent IS NULL OR char_length(user_agent) <= 2048),
  CONSTRAINT auth_devices_seen_order_check CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX auth_devices_user_last_seen_idx
  ON auth_devices(user_id, last_seen_at DESC);

CREATE UNIQUE INDEX auth_devices_last_session_unique_idx
  ON auth_devices(last_session_id)
  WHERE last_session_id IS NOT NULL;

INSERT INTO auth_devices (
  user_id,
  device_key,
  user_agent,
  first_seen_at,
  last_seen_at,
  last_session_id
)
SELECT
  user_id,
  left('legacy-session:' || id, 128),
  left(user_agent, 2048),
  created_at,
  updated_at,
  id
FROM "session"
ON CONFLICT (user_id, device_key) DO NOTHING;
