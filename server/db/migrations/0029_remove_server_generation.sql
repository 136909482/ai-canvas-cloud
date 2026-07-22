DO $$
BEGIN
  IF to_regclass('public.generation_tasks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS generation_tasks_record_event_trigger ON generation_tasks;
  END IF;
  IF to_regclass('public.provider_credentials') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS provider_credentials_fill_legacy_metadata_trigger ON provider_credentials;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS record_generation_task_event();
DROP FUNCTION IF EXISTS provider_credentials_fill_legacy_metadata();

DELETE FROM asset_references WHERE task_id IS NOT NULL;
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
