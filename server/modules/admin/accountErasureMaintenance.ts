import { withTransaction, type DbClient, type DbPool } from "../../db/postgres.js";
import type { AssetMaintenanceObjectStorage } from "../assets/assetMaintenance.js";

export const ACCOUNT_ERASURE_DEFAULT_BATCH_SIZE = 25;
export const ACCOUNT_ERASURE_MAX_BATCH_SIZE = 100;

export interface AccountErasureMaintenanceSummary {
  mode: "preflight" | "apply";
  scannedJobCount: number;
  dueJobCount: number;
  eligibleObjectCount: number;
  completedJobCount: number;
  failedJobCount: number;
  completedAt: string;
}

interface AccountErasureJobRow {
  id: string;
  user_id: string;
  personal_workspace_ids: unknown;
}

function parseWorkspaceIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Account erasure job has invalid workspace ids");
  }
  const ids = value.map((id) => {
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      throw new Error("Account erasure job has invalid workspace id");
    }
    return id.toLowerCase();
  });
  return [...new Set(ids)];
}

function validateBatchSize(value: number | undefined) {
  const batchSize = value ?? ACCOUNT_ERASURE_DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > ACCOUNT_ERASURE_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be between 1 and ${ACCOUNT_ERASURE_MAX_BATCH_SIZE}`,
    );
  }
  return batchSize;
}

async function dueJobs(
  database: Pick<DbPool | DbClient, "query">,
  batchSize: number,
) {
  const result = await database.query<AccountErasureJobRow>(
    `
      SELECT id::text, user_id, personal_workspace_ids
      FROM public.account_erasure_jobs
      WHERE status = 'pending'
        AND purge_after <= now()
      ORDER BY purge_after, id
      LIMIT $1
    `,
    [batchSize],
  );
  return result.rows;
}

async function objectKeys(
  database: Pick<DbPool | DbClient, "query">,
  workspaceIds: string[],
) {
  if (workspaceIds.length === 0) return [];
  const result = await database.query<{ object_key: string }>(
    `
      SELECT object_key FROM public.assets
      WHERE workspace_id = ANY($1::uuid[])
      UNION
      SELECT object_key FROM public.asset_uploads
      WHERE workspace_id = ANY($1::uuid[])
      UNION
      SELECT object_key FROM public.migration_import_asset_uploads
      WHERE workspace_id = ANY($1::uuid[])
      UNION
      SELECT archive_object_key AS object_key FROM public.migration_exports
      WHERE workspace_id = ANY($1::uuid[])
        AND archive_object_key IS NOT NULL
    `,
    [workspaceIds],
  );
  return result.rows.map((row) => row.object_key);
}

async function claimJob(pool: DbPool, jobId: string) {
  return withTransaction(pool, async (client) => {
    const row = await client.query<AccountErasureJobRow>(
      `
        SELECT id::text, user_id, personal_workspace_ids
        FROM public.account_erasure_jobs
        WHERE id = $1
          AND status = 'pending'
          AND purge_after <= now()
        FOR UPDATE SKIP LOCKED
      `,
      [jobId],
    );
    if (!row.rows[0]) return null;
    await client.query(
      `
        UPDATE public.account_erasure_jobs
        SET status = 'processing', attempt_count = attempt_count + 1,
            locked_at = now(), updated_at = now(), last_error_code = NULL
        WHERE id = $1
      `,
      [jobId],
    );
    return row.rows[0];
  });
}

async function completeJob(
  pool: DbPool,
  job: AccountErasureJobRow,
  workspaceIds: string[],
) {
  await withTransaction(pool, async (client) => {
    const locked = await client.query<{ id: string }>(
      `
        SELECT id::text FROM public.account_erasure_jobs
        WHERE id = $1 AND status = 'processing'
        FOR UPDATE
      `,
      [job.id],
    );
    if (!locked.rows[0]) return;
    if (workspaceIds.length > 0) {
      await client.query(
        `DELETE FROM public.migration_import_asset_uploads WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.migration_imports WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.migration_exports WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.asset_references WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.asset_uploads WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.assets WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.projects WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.workspace_user_state WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.workspace_members WHERE workspace_id = ANY($1::uuid[])`,
        [workspaceIds],
      );
      await client.query(
        `DELETE FROM public.workspaces WHERE id = ANY($1::uuid[]) AND type = 'personal' AND owner_user_id = $2`,
        [workspaceIds, job.user_id],
      );
    }
    await client.query(
      `
        UPDATE public."user"
        SET personal_data_purged_at = COALESCE(personal_data_purged_at, now()),
            updated_at = now()
        WHERE id = $1 AND status = 'deleted'
      `,
      [job.user_id],
    );
    await client.query(
      `
        UPDATE public.account_erasure_jobs
        SET status = 'completed', completed_at = now(), locked_at = NULL,
            updated_at = now(), last_error_code = NULL
        WHERE id = $1
      `,
      [job.id],
    );
  });
}

async function markJobFailed(pool: DbPool, jobId: string) {
  await pool.query(
    `
      UPDATE public.account_erasure_jobs
      SET status = 'pending', locked_at = NULL, last_error_code = 'object_cleanup_failed',
          updated_at = now()
      WHERE id = $1 AND status = 'processing'
    `,
    [jobId],
  );
}

export function createPostgresAccountErasureMaintenanceService(
  pool: DbPool,
  storage: Pick<AssetMaintenanceObjectStorage, "objectExists" | "deleteObject">,
) {
  return {
    async run(input: { apply?: boolean; batchSize?: number } = {}) {
      const batchSize = validateBatchSize(input.batchSize);
      const apply = input.apply === true;
      if (apply) {
        await pool.query(
          `
            UPDATE public.account_erasure_jobs
            SET status = 'pending', locked_at = NULL, updated_at = now()
            WHERE status = 'processing'
              AND locked_at < now() - interval '15 minutes'
          `,
        );
      }
      const jobs = await dueJobs(pool, batchSize);
      let eligibleObjectCount = 0;
      let completedJobCount = 0;
      let failedJobCount = 0;
      for (const candidate of jobs) {
        const job = apply ? await claimJob(pool, candidate.id) : candidate;
        if (!job) continue;
        const workspaceIds = parseWorkspaceIds(job.personal_workspace_ids);
        const keys = await objectKeys(pool, workspaceIds);
        eligibleObjectCount += keys.length;
        if (!apply) continue;
        try {
          for (const objectKey of keys) {
            if (await storage.objectExists(objectKey)) {
              await storage.deleteObject(objectKey);
            }
          }
          await completeJob(pool, job, workspaceIds);
          completedJobCount += 1;
        } catch {
          await markJobFailed(pool, job.id);
          failedJobCount += 1;
        }
      }
      return {
        mode: apply ? "apply" : "preflight",
        scannedJobCount: jobs.length,
        dueJobCount: jobs.length,
        eligibleObjectCount,
        completedJobCount,
        failedJobCount,
        completedAt: new Date().toISOString(),
      } satisfies AccountErasureMaintenanceSummary;
    },
  };
}
