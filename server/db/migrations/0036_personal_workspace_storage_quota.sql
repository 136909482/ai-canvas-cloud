ALTER TABLE workspaces
  ALTER COLUMN storage_quota_bytes SET DEFAULT 10737418240;

UPDATE workspaces
SET storage_quota_bytes = 10737418240,
    updated_at = now()
WHERE type = 'personal'
  AND storage_quota_bytes = 21474836480;
