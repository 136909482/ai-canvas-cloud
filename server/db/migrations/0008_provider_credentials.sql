CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider_id text NOT NULL,
  base_url text NOT NULL,
  encrypted_secret_json jsonb NOT NULL,
  key_version integer NOT NULL,
  secret_last_four text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  updated_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_credentials_workspace_provider_unique UNIQUE (workspace_id, provider_id),
  CONSTRAINT provider_credentials_provider_id_check CHECK (
    char_length(provider_id) BETWEEN 1 AND 80 AND provider_id ~ '^[a-z0-9][a-z0-9_-]*$'
  ),
  CONSTRAINT provider_credentials_base_url_check CHECK (
    char_length(base_url) BETWEEN 12 AND 512
    AND base_url ~ '^https://'
    AND base_url !~ '[[:space:]]'
  ),
  CONSTRAINT provider_credentials_envelope_object_check CHECK (
    jsonb_typeof(encrypted_secret_json) = 'object'
    AND encrypted_secret_json ?& ARRAY['algorithm', 'keyVersion', 'iv', 'ciphertext', 'authTag']
    AND encrypted_secret_json ->> 'algorithm' = 'aes-256-gcm'
    AND jsonb_typeof(encrypted_secret_json -> 'keyVersion') = 'number'
    AND (encrypted_secret_json ->> 'keyVersion')::integer = key_version
  ),
  CONSTRAINT provider_credentials_key_version_positive CHECK (key_version > 0),
  CONSTRAINT provider_credentials_last_four_check CHECK (char_length(secret_last_four) = 4),
  CONSTRAINT provider_credentials_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX provider_credentials_workspace_status_idx
  ON provider_credentials(workspace_id, status, provider_id);
