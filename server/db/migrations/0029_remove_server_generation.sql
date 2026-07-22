DO $$
DECLARE
  current_revision record;
  cleaned_config jsonb;
  replacement_revision_id uuid;
  replacement_etag text;
BEGIN
  IF to_regclass('admin.site_config_current') IS NOT NULL
    AND to_regclass('admin.site_config_revisions') IS NOT NULL
    AND to_regclass('public.site_config_publications') IS NOT NULL
  THEN
    SELECT
      r.created_by_admin_id,
      c.updated_by_admin_id,
      r.config_json AS revision_config
    INTO current_revision
    FROM admin.site_config_current c
    JOIN admin.site_config_revisions r ON r.id = c.revision_id
    JOIN public.site_config_publications p ON p.revision_id = r.id
    WHERE c.singleton_id = 1
      AND (
        (r.config_json -> 'features') ? 'officialModeEnabled'
        OR (p.config_json -> 'features') ? 'officialModeEnabled'
      )
    FOR UPDATE OF c, p;

    IF FOUND THEN
      cleaned_config := current_revision.revision_config #- '{features,officialModeEnabled}';
      replacement_revision_id := gen_random_uuid();
      replacement_etag := '"'
        || encode(sha256(convert_to(cleaned_config::text, 'UTF8')), 'hex')
        || '"';

      INSERT INTO admin.site_config_revisions (
        id,
        schema_version,
        config_json,
        note,
        created_by_admin_id
      ) VALUES (
        replacement_revision_id,
        1,
        cleaned_config,
        'P8-4 removed the retired official generation mode from the active site configuration.',
        current_revision.created_by_admin_id
      );

      UPDATE admin.site_config_current
      SET revision_id = replacement_revision_id,
          updated_by_admin_id = current_revision.updated_by_admin_id,
          updated_at = now()
      WHERE singleton_id = 1;

      UPDATE public.site_config_publications
      SET revision_id = replacement_revision_id,
          etag = replacement_etag,
          config_json = cleaned_config,
          published_at = now()
      WHERE singleton_id = 1;
    END IF;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('generation_tasks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS generation_tasks_record_event_trigger ON generation_tasks;
  END IF;
  IF to_regclass('provider_credentials') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS provider_credentials_fill_legacy_metadata_trigger ON provider_credentials;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS record_generation_task_event();
DROP FUNCTION IF EXISTS provider_credentials_fill_legacy_metadata();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'asset_references'
      AND column_name = 'task_id'
  ) THEN
    DELETE FROM asset_references WHERE task_id IS NOT NULL;
  END IF;
END
$$;
DROP INDEX IF EXISTS asset_references_task_unique_idx;
ALTER TABLE asset_references
  DROP CONSTRAINT IF EXISTS asset_references_workspace_task_fk,
  DROP CONSTRAINT IF EXISTS asset_references_target_check,
  DROP COLUMN IF EXISTS task_id,
  ALTER COLUMN node_id SET NOT NULL;

DO $$
DECLARE
  function_row record;
BEGIN
  FOR function_row IN
    SELECT oid::regprocedure AS signature
    FROM pg_proc
    WHERE proname = ANY (ARRAY[
      'reserve_official_generation_task',
      'read_official_task_execution',
      'read_official_credit_balance',
      'adjust_official_credits'
    ])
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', function_row.signature);
  END LOOP;
END
$$;

DROP TABLE IF EXISTS public.official_model_publications CASCADE;
DROP TABLE IF EXISTS public.official_credit_ledger CASCADE;
DROP TABLE IF EXISTS public.workspace_official_credit_periods CASCADE;
DROP TABLE IF EXISTS admin.official_model_revisions CASCADE;
DROP TABLE IF EXISTS admin.official_models CASCADE;
DROP TABLE IF EXISTS admin.official_provider_revision_tests CASCADE;
DROP TABLE IF EXISTS admin.official_provider_secrets CASCADE;
DROP TABLE IF EXISTS admin.official_provider_revisions CASCADE;
DROP TABLE IF EXISTS admin.official_providers CASCADE;

DROP TABLE IF EXISTS usage_ledger CASCADE;
DROP TABLE IF EXISTS generation_task_events CASCADE;
DROP TABLE IF EXISTS task_queue_outbox CASCADE;
DROP TABLE IF EXISTS task_commands CASCADE;
DROP TABLE IF EXISTS task_attempts CASCADE;
DROP TABLE IF EXISTS generation_tasks CASCADE;
DROP TABLE IF EXISTS provider_credentials CASCADE;
