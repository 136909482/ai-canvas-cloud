import type { AdminDashboardResponse, AdminDependencyHealth } from '@ai-canvas-cloud/contracts'
import type { DbPool } from '../../db/postgres.js'
import type { AdminService } from './service.js'
import type { AdminRequestContext } from './types.js'

interface AdminDashboardRow {
  registrations_total: string | number
  registrations_24h: string | number
  registrations_7d: string | number
  active_users_24h: string | number
  active_users_7d: string | number
  active_sessions: string | number
  storage_used_bytes: string | number
  storage_reserved_bytes: string | number
  storage_quota_bytes: string | number
  asset_count: string | number
  verified_users: string | number
  unverified_users: string | number
  disabled_users: string | number
}

export interface AdminDashboardService {
  getDashboard(context: AdminRequestContext): Promise<AdminDashboardResponse>
}

export interface AdminInfrastructureHealth {
  postgres: AdminDependencyHealth
  objectStorage: AdminDependencyHealth
}

export interface PostgresAdminDashboardOptions {
  adminService: Pick<AdminService, 'requirePermission'>
  readInfrastructureHealth: () => Promise<AdminInfrastructureHealth>
}

export function createUnavailableAdminDashboardService(): AdminDashboardService {
  return {
    async getDashboard() {
      throw new Error('Administrator dashboard service is unavailable')
    },
  }
}

const UNKNOWN_INFRASTRUCTURE: AdminInfrastructureHealth = {
  postgres: { ok: false, latencyMs: 0, error: 'unknown' },
  objectStorage: { ok: false, latencyMs: 0, error: 'unknown' },
}

function toSafeInteger(value: string | number, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} is outside the safe integer range`)
  return parsed
}

async function readSafeInfrastructure(options: PostgresAdminDashboardOptions) {
  try {
    return await options.readInfrastructureHealth()
  } catch {
    return UNKNOWN_INFRASTRUCTURE
  }
}

export function createPostgresAdminDashboardService(
  pool: DbPool,
  options: PostgresAdminDashboardOptions,
): AdminDashboardService {
  return {
    async getDashboard(context) {
      await options.adminService.requirePermission(context, 'dashboard.read')
      const [result, infrastructure] = await Promise.all([
        pool.query<AdminDashboardRow>(`
          WITH user_totals AS (
            SELECT
              count(*) FILTER (WHERE status <> 'deleted')::bigint AS registrations_total,
              count(*) FILTER (WHERE status <> 'deleted' AND created_at >= now() - interval '24 hours')::bigint AS registrations_24h,
              count(*) FILTER (WHERE status <> 'deleted' AND created_at >= now() - interval '7 days')::bigint AS registrations_7d,
              count(*) FILTER (WHERE status <> 'deleted' AND email_verified)::bigint AS verified_users,
              count(*) FILTER (WHERE status <> 'deleted' AND NOT email_verified)::bigint AS unverified_users,
              count(*) FILTER (WHERE status = 'disabled')::bigint AS disabled_users
            FROM public."user"
          ), session_totals AS (
            SELECT
              count(DISTINCT s.user_id) FILTER (
                WHERE s.expires_at > now() AND s.updated_at >= now() - interval '24 hours'
              )::bigint AS active_users_24h,
              count(DISTINCT s.user_id) FILTER (
                WHERE s.expires_at > now() AND s.updated_at >= now() - interval '7 days'
              )::bigint AS active_users_7d,
              count(*) FILTER (WHERE s.expires_at > now())::bigint AS active_sessions
            FROM public."session" s
            JOIN public."user" u ON u.id = s.user_id AND u.status <> 'deleted'
          ), asset_totals AS (
            SELECT
              COALESCE(sum(a.byte_size) FILTER (
                WHERE a.deleted_at IS NULL
                  AND a.status IN ('completed', 'failed', 'quarantined')
              ), 0)::bigint AS storage_used_bytes,
              COALESCE(sum(a.byte_size) FILTER (
                WHERE a.deleted_at IS NULL AND a.status = 'pending'
              ), 0)::bigint AS asset_reserved_bytes,
              count(*) FILTER (
                WHERE a.deleted_at IS NULL
                  AND a.status IN ('completed', 'failed', 'quarantined')
              )::bigint AS asset_count
            FROM public.assets a
            JOIN public.workspaces w ON w.id = a.workspace_id AND w.status <> 'deleted'
          ), workspace_totals AS (
            SELECT COALESCE(sum(storage_quota_bytes), 0)::bigint AS storage_quota_bytes
            FROM public.workspaces
            WHERE status <> 'deleted'
          ), import_totals AS (
            SELECT COALESCE(sum(upload.expected_byte_size), 0)::bigint AS import_reserved_bytes
            FROM public.migration_import_asset_uploads upload
            JOIN public.workspaces w ON w.id = upload.workspace_id AND w.status <> 'deleted'
            WHERE upload.status IN ('pending', 'uploading', 'validating', 'completed')
              AND upload.committed_asset_id IS NULL
          )
          SELECT
            user_totals.registrations_total,
            user_totals.registrations_24h,
            user_totals.registrations_7d,
            session_totals.active_users_24h,
            session_totals.active_users_7d,
            session_totals.active_sessions,
            asset_totals.storage_used_bytes,
            (asset_totals.asset_reserved_bytes + import_totals.import_reserved_bytes)::bigint AS storage_reserved_bytes,
            workspace_totals.storage_quota_bytes,
            asset_totals.asset_count,
            user_totals.verified_users,
            user_totals.unverified_users,
            user_totals.disabled_users
          FROM user_totals, session_totals, asset_totals, workspace_totals, import_totals
        `),
        readSafeInfrastructure(options),
      ])
      const row = result.rows[0]
      if (!row) throw new Error('Administrator dashboard aggregate is unavailable')
      return {
        generatedAt: new Date().toISOString(),
        registrations: {
          total: toSafeInteger(row.registrations_total, 'registrations.total'),
          past24Hours: toSafeInteger(row.registrations_24h, 'registrations.past24Hours'),
          past7Days: toSafeInteger(row.registrations_7d, 'registrations.past7Days'),
        },
        activity: {
          activeUsers24Hours: toSafeInteger(row.active_users_24h, 'activity.activeUsers24Hours'),
          activeUsers7Days: toSafeInteger(row.active_users_7d, 'activity.activeUsers7Days'),
          activeSessions: toSafeInteger(row.active_sessions, 'activity.activeSessions'),
        },
        storage: {
          usedBytes: toSafeInteger(row.storage_used_bytes, 'storage.usedBytes'),
          reservedBytes: toSafeInteger(row.storage_reserved_bytes, 'storage.reservedBytes'),
          quotaBytes: toSafeInteger(row.storage_quota_bytes, 'storage.quotaBytes'),
          assetCount: toSafeInteger(row.asset_count, 'storage.assetCount'),
        },
        authentication: {
          verifiedUsers: toSafeInteger(row.verified_users, 'authentication.verifiedUsers'),
          unverifiedUsers: toSafeInteger(row.unverified_users, 'authentication.unverifiedUsers'),
          disabledUsers: toSafeInteger(row.disabled_users, 'authentication.disabledUsers'),
        },
        infrastructure,
      }
    },
  }
}
