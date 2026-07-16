import type { WorkspaceUsageResponse } from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from './authorization.js'

export const DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES = 20 * 1024 * 1024 * 1024

interface WorkspaceStorageUsageRow {
  workspace_id: string
  quota_bytes: string | number
  used_bytes: string | number
  reserved_bytes: string | number
}

export interface WorkspaceUsageService {
  getCurrentUsage: (actor: ProjectActor) => Promise<WorkspaceUsageResponse>
}

function toSafeBytes(value: string | number, field: string) {
  const bytes = Number(value)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return bytes
}

export function calculateWorkspaceStorageUsage(input: {
  workspaceId: string
  quotaBytes: string | number
  usedBytes: string | number
  reservedBytes: string | number
}): WorkspaceUsageResponse {
  const quotaBytes = toSafeBytes(input.quotaBytes, 'quotaBytes')
  const usedBytes = toSafeBytes(input.usedBytes, 'usedBytes')
  const reservedBytes = toSafeBytes(input.reservedBytes, 'reservedBytes')
  const totalBytes = usedBytes + reservedBytes
  if (!Number.isSafeInteger(totalBytes)) {
    throw new Error('totalBytes must be a safe integer')
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
  }
}

export async function readWorkspaceStorageUsage(
  client: Pick<DbClient, 'query'>,
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
        ), 0) AS reserved_bytes
      FROM workspaces w
      LEFT JOIN assets a
        ON a.workspace_id = w.id
       AND a.deleted_at IS NULL
       AND a.status <> 'deleted'
      WHERE w.id = $1
        AND w.status <> 'deleted'
      GROUP BY w.id, w.storage_quota_bytes
      LIMIT 1
    `,
    [workspaceId],
  )
  const row = result.rows[0]
  if (!row) {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: 'RESOURCE_NOT_FOUND',
      message: 'Workspace not found',
    })
  }

  return calculateWorkspaceStorageUsage({
    workspaceId: row.workspace_id,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    reservedBytes: row.reserved_bytes,
  })
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
  )
  if (!result.rows[0]) {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: 'RESOURCE_NOT_FOUND',
      message: 'Workspace not found',
    })
  }
}

export function assertWorkspaceStorageCapacity(
  usage: WorkspaceUsageResponse,
  requestedBytes: number,
) {
  if (requestedBytes > usage.storage.availableBytes) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'QUOTA_EXCEEDED',
      message: 'Workspace storage quota exceeded',
      details: {
        quotaBytes: usage.storage.quotaBytes,
        usedBytes: usage.storage.usedBytes,
        reservedBytes: usage.storage.reservedBytes,
        availableBytes: usage.storage.availableBytes,
        requestedBytes,
      },
    })
  }
}

export function createPostgresWorkspaceUsageService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): WorkspaceUsageService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)

  return {
    async getCurrentUsage(actor) {
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      return readWorkspaceStorageUsage(pool, actor.workspaceId)
    },
  }
}

export function createUnavailableWorkspaceUsageService(): WorkspaceUsageService {
  return {
    async getCurrentUsage() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: 'SERVICE_UNAVAILABLE',
        message: 'Workspace usage service is not configured',
        retryable: true,
      })
    },
  }
}
