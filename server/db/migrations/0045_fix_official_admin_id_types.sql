-- Admin Better Auth identifiers are opaque text values, not UUIDs.
ALTER TABLE public.official_provider_revisions
  ALTER COLUMN created_by_admin_id TYPE text USING created_by_admin_id::text;

ALTER TABLE public.credit_settings
  ALTER COLUMN updated_by_admin_id TYPE text USING updated_by_admin_id::text;

ALTER TABLE public.redemption_code_batches
  ALTER COLUMN created_by_admin_id TYPE text USING created_by_admin_id::text;
