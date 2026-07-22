CREATE TABLE IF NOT EXISTS admin.site_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_kind text NOT NULL,
  object_key text NOT NULL,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  uploaded_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  upload_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT admin_site_assets_kind_check CHECK (asset_kind IN ('logo', 'favicon')),
  CONSTRAINT admin_site_assets_mime_check CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/x-icon')),
  CONSTRAINT admin_site_assets_byte_size_check CHECK (byte_size BETWEEN 1 AND 4194304),
  CONSTRAINT admin_site_assets_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_site_assets_dimensions_check CHECK (width BETWEEN 1 AND 4096 AND height BETWEEN 1 AND 4096),
  CONSTRAINT admin_site_assets_status_check CHECK (status IN ('pending', 'completed', 'failed', 'deleted')),
  CONSTRAINT admin_site_assets_idempotency_check CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT admin_site_assets_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_site_assets_object_key_unique UNIQUE (object_key),
  CONSTRAINT admin_site_assets_idempotency_unique UNIQUE (uploaded_by_admin_id, idempotency_key),
  CONSTRAINT admin_site_assets_completion_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status IN ('pending', 'failed') AND completed_at IS NULL AND deleted_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_site_assets_status_created_idx
  ON admin.site_assets(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS admin.site_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL,
  config_json jsonb NOT NULL,
  note text,
  created_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_site_config_schema_version_check CHECK (schema_version = 1),
  CONSTRAINT admin_site_config_json_object_check CHECK (jsonb_typeof(config_json) = 'object'),
  CONSTRAINT admin_site_config_note_check CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS admin.site_config_current (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL UNIQUE REFERENCES admin.site_config_revisions(id),
  updated_by_admin_id text NOT NULL REFERENCES admin."user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_site_config_current_singleton_check CHECK (singleton_id = 1)
);

CREATE TABLE IF NOT EXISTS public.site_config_publications (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  revision_id uuid NOT NULL,
  etag text NOT NULL,
  config_json jsonb NOT NULL,
  logo_asset_id uuid,
  logo_object_key text,
  logo_mime_type text,
  favicon_asset_id uuid,
  favicon_object_key text,
  favicon_mime_type text,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_config_publications_singleton_check CHECK (singleton_id = 1),
  CONSTRAINT site_config_publications_etag_check CHECK (etag ~ '^"[0-9a-f]{64}"$'),
  CONSTRAINT site_config_publications_json_object_check CHECK (jsonb_typeof(config_json) = 'object'),
  CONSTRAINT site_config_publications_logo_check CHECK (
    (logo_asset_id IS NULL AND logo_object_key IS NULL AND logo_mime_type IS NULL)
    OR (logo_asset_id IS NOT NULL AND logo_object_key IS NOT NULL AND logo_mime_type IS NOT NULL)
  ),
  CONSTRAINT site_config_publications_favicon_check CHECK (
    (favicon_asset_id IS NULL AND favicon_object_key IS NULL AND favicon_mime_type IS NULL)
    OR (favicon_asset_id IS NOT NULL AND favicon_object_key IS NOT NULL AND favicon_mime_type IS NOT NULL)
  )
);

REVOKE ALL ON public.site_config_publications FROM PUBLIC;

CREATE OR REPLACE FUNCTION admin.reject_site_config_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'site configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS admin_site_config_revisions_immutable ON admin.site_config_revisions;
CREATE TRIGGER admin_site_config_revisions_immutable
BEFORE UPDATE OR DELETE ON admin.site_config_revisions
FOR EACH ROW EXECUTE FUNCTION admin.reject_site_config_revision_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin FROM PUBLIC;
