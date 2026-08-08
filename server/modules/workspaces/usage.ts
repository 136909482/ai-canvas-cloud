import type {
  WorkspaceProjectStorageSummary,
  WorkspaceUsageResponse,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "./authorization.js";

export const DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES =
  10 * 1024 * 1024 * 1024;

interface WorkspaceStorageUsageRow {
  workspace_id: string;
  quota_bytes: string | number;
  used_bytes: string | number;
  reserved_bytes: string | number;
}

interface WorkspaceProjectStorageRow {
  project_id: string;
  name: string;
  file_count: string | number;
  node_count: number;
  storage_bytes: string | number;
  archived_at: Date | string | null;
  updated_at: Date | string;
}

function billableAssetPredicate(assetAlias: "a") {
  return `
    (
      ${assetAlias}.quota_released_at IS NULL
      AND (
        ${assetAlias}.origin_project_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM projects origin_project
          WHERE origin_project.workspace_id = ${assetAlias}.workspace_id
            AND origin_project.id = ${assetAlias}.origin_project_id
            AND origin_project.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM asset_references ar
          JOIN projects referenced_project
            ON referenced_project.workspace_id = ar.workspace_id
           AND referenced_project.id = ar.project_id
          WHERE ar.workspace_id = ${assetAlias}.workspace_id
            AND ar.asset_id = ${assetAlias}.id
            AND referenced_project.deleted_at IS NULL
        )
      )
    )
  `;
}

export interface WorkspaceUsageService {
  getCurrentUsage: (actor: ProjectActor) => Promise<WorkspaceUsageResponse>;
}

function toSafeBytes(value: string | number, field: string) {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return bytes;
}

export function calculateWorkspaceStorageUsage(input: {
  workspaceId: string;
  quotaBytes: string | number;
  usedBytes: string | number;
  reservedBytes: string | number;
  projects?: WorkspaceProjectStorageSummary[];
}): WorkspaceUsageResponse {
  const quotaBytes = toSafeBytes(input.quotaBytes, "quotaBytes");
  const usedBytes = toSafeBytes(input.usedBytes, "usedBytes");
  const reservedBytes = toSafeBytes(input.reservedBytes, "reservedBytes");
  const totalBytes = usedBytes + reservedBytes;
  if (!Number.isSafeInteger(totalBytes)) {
    throw new Error("totalBytes must be a safe integer");
  }

  return {
    workspaceId: input.workspaceId,
    storage: {
      usedBytes,
      reservedBytes,
      totalBytes,
      quotaBytes,
      availableBytes: Math.max(quotaBytes - totalBytes, 0),
    },
    projects: input.projects ?? [],
  };
}

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export async function readWorkspaceProjectStorageUsage(
  client: Pick<DbClient, "query">,
  workspaceId: string,
) {
  const result = await client.query<WorkspaceProjectStorageRow>(
    `
      SELECT
        p.id::text AS project_id,
        p.name,
        COUNT(a.id) FILTER (
          WHERE a.status IN ('pending', 'completed', 'failed', 'quarantined')
        ) AS file_count,
        p.node_count,
        COALESCE(SUM(a.byte_size) FILTER (
          WHERE a.status IN ('pending', 'completed', 'failed', 'quarantined')
        ), 0) AS storage_bytes,
        p.archived_at,
        p.updated_at
      FROM projects p
      LEFT JOIN assets a
        ON a.workspace_id = p.workspace_id
       AND a.deleted_at IS NULL
       AND a.status <> 'deleted'
       AND ${billableAssetPredicate("a")}
       AND p.id = COALESCE(
         (
           SELECT a.origin_project_id
           FROM projects origin_project
           WHERE origin_project.workspace_id = a.workspace_id
             AND origin_project.id = a.origin_project_id
             AND origin_project.deleted_at IS NULL
         ),
         (
           SELECT ar.project_id
           FROM asset_references ar
           JOIN projects referenced_project
             ON referenced_project.workspace_id = ar.workspace_id
            AND referenced_project.id = ar.project_id
           WHERE ar.workspace_id = a.workspace_id
             AND ar.asset_id = a.id
             AND referenced_project.deleted_at IS NULL
           ORDER BY ar.project_id
           LIMIT 1
         ),
         (
           SELECT snapshot.project_id
           FROM project_snapshots snapshot
           JOIN projects snapshot_project
             ON snapshot_project.id = snapshot.project_id
           WHERE snapshot_project.workspace_id = a.workspace_id
             AND snapshot_project.deleted_at IS NULL
             AND snapshot.is_valid
             AND snapshot.asset_manifest_json ? a.id::text
           ORDER BY snapshot.project_id
           LIMIT 1
         )
       )
      WHERE p.workspace_id = $1
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.node_count, p.archived_at, p.updated_at
      ORDER BY storage_bytes DESC, p.updated_at DESC, p.id DESC
    `,
    [workspaceId],
  );

  return result.rows.map((row): WorkspaceProjectStorageSummary => ({
    projectId: row.project_id,
    name: row.name,
    fileCount: toSafeBytes(row.file_count, "fileCount"),
    nodeCount: row.node_count,
    storageBytes: toSafeBytes(row.storage_bytes, "storageBytes"),
    archivedAt: row.archived_at ? toIso(row.archived_at) : null,
    updatedAt: toIso(row.updated_at),
  }));
}

export async function readWorkspaceStorageUsage(
  client: Pick<DbClient, "query">,
  workspaceId: string,
) {
  const result = await client.query<WorkspaceStorageUsageRow>(
    `
      SELECT
        w.id::text AS workspace_id,
        w.storage_quota_bytes AS quota_bytes,
        COALESCE(SUM(a.byte_size) FILTER (
          WHERE a.status IN ('completed', 'failed', 'quarantined')
        ), 0) AS used_bytes,
        COALESCE(SUM(a.byte_size) FILTER (
          WHERE a.status = 'pending'
        ), 0) + COALESCE((
          SELECT SUM(miau.expected_byte_size)
          FROM migration_import_asset_uploads miau
          LEFT JOIN migration_imports mi
            ON mi.workspace_id = miau.workspace_id
           AND mi.id = miau.import_id
          WHERE miau.workspace_id = w.id
            AND miau.status IN ('pending', 'uploading', 'validating', 'completed')
            AND miau.committed_asset_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM projects migration_project
              WHERE migration_project.workspace_id = miau.workspace_id
                AND migration_project.id = COALESCE(mi.committed_project_id, mi.target_project_id)
                AND migration_project.deleted_at IS NOT NULL
            )
        ), 0) AS reserved_bytes
      FROM workspaces w
      LEFT JOIN assets a
        ON a.workspace_id = w.id
       AND a.deleted_at IS NULL
       AND a.status <> 'deleted'
       AND ${billableAssetPredicate("a")}
      WHERE w.id = $1
        AND w.status <> 'deleted'
      GROUP BY w.id, w.storage_quota_bytes
      LIMIT 1
    `,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: "RESOURCE_NOT_FOUND",
      message: "Workspace not found",
    });
  }

  return calculateWorkspaceStorageUsage({
    workspaceId: row.workspace_id,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    reservedBytes: row.reserved_bytes,
  });
}

export async function lockWorkspaceStorageQuota(
  client: DbClient,
  workspaceId: string,
) {
  const result = await client.query(
    `
      SELECT storage_quota_bytes
      FROM workspaces
      WHERE id = $1
        AND status = 'active'
      FOR UPDATE
    `,
    [workspaceId],
  );
  if (!result.rows[0]) {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: "RESOURCE_NOT_FOUND",
      message: "Workspace not found",
    });
  }
}

export function assertWorkspaceStorageCapacity(
  usage: WorkspaceUsageResponse,
  requestedBytes: number,
) {
  if (requestedBytes > usage.storage.availableBytes) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "QUOTA_EXCEEDED",
      message: "Workspace storage quota exceeded",
      details: {
        quotaBytes: usage.storage.quotaBytes,
        usedBytes: usage.storage.usedBytes,
        reservedBytes: usage.storage.reservedBytes,
        availableBytes: usage.storage.availableBytes,
        requestedBytes,
      },
    });
  }
}

export function createPostgresWorkspaceUsageService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): WorkspaceUsageService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  return {
    async getCurrentUsage(actor) {
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });
      const [usage, projects] = await Promise.all([
        readWorkspaceStorageUsage(pool, actor.workspaceId),
        readWorkspaceProjectStorageUsage(pool, actor.workspaceId),
      ]);
      return {
        ...usage,
        projects,
      };
    },
  };
}

export function createUnavailableWorkspaceUsageService(): WorkspaceUsageService {
  return {
    async getCurrentUsage() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: "SERVICE_UNAVAILABLE",
        message: "Workspace usage service is not configured",
        retryable: true,
      });
    },
  };
}
