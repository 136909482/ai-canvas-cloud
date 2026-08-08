ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS quota_released_at timestamp with time zone;

COMMENT ON COLUMN public.assets.quota_released_at IS
  'Logical quota release time; object retention and GC remain separate.';

UPDATE public.assets a
SET quota_released_at = COALESCE(quota_released_at, now()), updated_at = now()
WHERE a.quota_released_at IS NULL
  AND a.deleted_at IS NULL
  AND a.status IN ('completed', 'failed', 'quarantined')
  AND a.origin_project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.asset_references ar
    JOIN public.projects p
      ON p.workspace_id = ar.workspace_id
     AND p.id = ar.project_id
    WHERE ar.workspace_id = a.workspace_id
      AND ar.asset_id = a.id
      AND p.deleted_at IS NULL
  );
