CREATE TABLE IF NOT EXISTS admin.object_storage_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  public_endpoint text NOT NULL,
  public_origin text NOT NULL,
  region text NOT NULL,
  bucket text NOT NULL,
  force_path_style boolean NOT NULL,
  encrypted_credentials_json jsonb NOT NULL,
  key_version integer NOT NULL,
  created_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_object_storage_endpoint_check CHECK (char_length(endpoint) BETWEEN 8 AND 2048),
  CONSTRAINT admin_object_storage_public_endpoint_check CHECK (char_length(public_endpoint) BETWEEN 8 AND 2048),
  CONSTRAINT admin_object_storage_public_origin_check CHECK (char_length(public_origin) BETWEEN 8 AND 2048),
  CONSTRAINT admin_object_storage_region_check CHECK (region ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT admin_object_storage_bucket_check CHECK (
    bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' AND position('..' IN bucket) = 0
  ),
  CONSTRAINT admin_object_storage_key_version_check CHECK (key_version > 0),
  CONSTRAINT admin_object_storage_envelope_check CHECK (
    jsonb_typeof(encrypted_credentials_json) = 'object'
    AND encrypted_credentials_json ?& ARRAY['algorithm', 'keyVersion', 'iv', 'ciphertext', 'authTag']
    AND encrypted_credentials_json ->> 'algorithm' = 'aes-256-gcm'
    AND (encrypted_credentials_json ->> 'keyVersion')::integer = key_version
  )
);

CREATE TABLE IF NOT EXISTS admin.object_storage_config_current (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL UNIQUE REFERENCES admin.object_storage_config_revisions(id),
  updated_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_object_storage_config_current_singleton_check CHECK (singleton_id = 1)
);

CREATE TABLE IF NOT EXISTS public.object_storage_config_publications (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL,
  endpoint text NOT NULL,
  public_endpoint text NOT NULL,
  public_origin text NOT NULL,
  region text NOT NULL,
  bucket text NOT NULL,
  force_path_style boolean NOT NULL,
  encrypted_credentials_json jsonb NOT NULL,
  key_version integer NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT object_storage_config_publications_singleton_check CHECK (singleton_id = 1),
  CONSTRAINT object_storage_config_publications_key_version_check CHECK (key_version > 0),
  CONSTRAINT object_storage_config_publications_envelope_check CHECK (
    jsonb_typeof(encrypted_credentials_json) = 'object'
    AND encrypted_credentials_json ?& ARRAY['algorithm', 'keyVersion', 'iv', 'ciphertext', 'authTag']
    AND encrypted_credentials_json ->> 'algorithm' = 'aes-256-gcm'
    AND (encrypted_credentials_json ->> 'keyVersion')::integer = key_version
  )
);

CREATE TABLE IF NOT EXISTS admin.object_storage_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text NOT NULL REFERENCES admin."user"(id),
  result text NOT NULL DEFAULT 'pending',
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT admin_object_storage_test_result_check CHECK (result IN ('pending', 'success', 'failure')),
  CONSTRAINT admin_object_storage_test_completion_check CHECK (
    (result = 'pending' AND completed_at IS NULL)
    OR (result IN ('success', 'failure') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_object_storage_test_attempts_admin_created_idx
  ON admin.object_storage_test_attempts(admin_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin.reject_object_storage_config_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Object storage configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_object_storage_config_revisions_immutable
  ON admin.object_storage_config_revisions;
CREATE TRIGGER admin_object_storage_config_revisions_immutable
BEFORE UPDATE OR DELETE ON admin.object_storage_config_revisions
FOR EACH ROW EXECUTE FUNCTION admin.reject_object_storage_config_revision_mutation();

REVOKE ALL ON public.object_storage_config_publications FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin FROM PUBLIC;

COMMENT ON TABLE admin.object_storage_config_revisions IS
  'Immutable administrator-managed object storage revisions with AES-256-GCM credentials.';
COMMENT ON TABLE public.object_storage_config_publications IS
  'Current encrypted object storage projection readable only by the ordinary API role.';
COMMENT ON TABLE admin.object_storage_test_attempts IS
  'Bounded object storage read-write-delete connection tests without object keys or credentials.';
