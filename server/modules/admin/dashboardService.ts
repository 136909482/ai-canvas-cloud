import {
  generationFailureCategories,
  type AdminDashboardResponse,
  type AdminDependencyHealth,
  type AdminGenerationDailySummary,
  type AdminGenerationPeriodSummary,
  type GenerationFailureCategory,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import type { AdminService } from "./service.js";
import type { AdminRequestContext } from "./types.js";

interface AdminGenerationPeriodRow {
  requests: string | number;
  succeeded: string | number;
  failed: string | number;
  canceled: string | number;
  results: string | number;
  active_creators: string | number;
  p95_duration_ms: string | number | null;
}

interface AdminGenerationDailyRow {
  date: string;
  text: string | number;
  image: string | number;
  video: string | number;
  succeeded: string | number;
  failed: string | number;
  canceled: string | number;
}

interface AdminGenerationFailureRow {
  category: string;
  count: string | number;
}

interface AdminDashboardRow {
  registrations_total: string | number;
  registrations_24h: string | number;
  registrations_7d: string | number;
  registrations_today: string | number;
  registrations_yesterday_same_period: string | number;
  active_users_24h: string | number;
  active_users_7d: string | number;
  active_sessions: string | number;
  storage_used_bytes: string | number;
  storage_reserved_bytes: string | number;
  storage_quota_bytes: string | number;
  asset_count: string | number;
  verified_users: string | number;
  unverified_users: string | number;
  disabled_users: string | number;
  generation_today: AdminGenerationPeriodRow[];
  generation_yesterday_same_period: AdminGenerationPeriodRow[];
  generation_daily: AdminGenerationDailyRow[];
  generation_failures: AdminGenerationFailureRow[];
}

export interface AdminDashboardService {
  getDashboard(context: AdminRequestContext): Promise<AdminDashboardResponse>;
}

export interface AdminInfrastructureHealth {
  postgres: AdminDependencyHealth;
  objectStorage: AdminDependencyHealth;
}

export interface PostgresAdminDashboardOptions {
  adminService: Pick<AdminService, "requirePermission">;
  readInfrastructureHealth: () => Promise<AdminInfrastructureHealth>;
}

export function createUnavailableAdminDashboardService(): AdminDashboardService {
  return {
    async getDashboard() {
      throw new Error("Administrator dashboard service is unavailable");
    },
  };
}

const UNKNOWN_INFRASTRUCTURE: AdminInfrastructureHealth = {
  postgres: { ok: false, latencyMs: 0, error: "unknown" },
  objectStorage: { ok: false, latencyMs: 0, error: "unknown" },
};

function toSafeInteger(value: string | number, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${field} is outside the safe integer range`);
  return parsed;
}

function toOptionalDuration(value: string | number | null, field: string) {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 86_400_000) {
    throw new Error(`${field} is outside the duration range`);
  }
  return Math.round(parsed);
}

function successRate(succeeded: number, failed: number) {
  const completed = succeeded + failed;
  return completed > 0 ? (succeeded / completed) * 100 : 0;
}

function toGenerationPeriod(
  rows: AdminGenerationPeriodRow[],
  field: string,
): AdminGenerationPeriodSummary {
  const row = rows[0] ?? {
    requests: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    results: 0,
    active_creators: 0,
    p95_duration_ms: null,
  };
  const succeeded = toSafeInteger(row.succeeded, `${field}.succeeded`);
  const failed = toSafeInteger(row.failed, `${field}.failed`);
  return {
    requests: toSafeInteger(row.requests, `${field}.requests`),
    succeeded,
    failed,
    canceled: toSafeInteger(row.canceled, `${field}.canceled`),
    results: toSafeInteger(row.results, `${field}.results`),
    activeCreators: toSafeInteger(
      row.active_creators,
      `${field}.activeCreators`,
    ),
    successRate: successRate(succeeded, failed),
    p95DurationMs: toOptionalDuration(
      row.p95_duration_ms,
      `${field}.p95DurationMs`,
    ),
  };
}

function toGenerationDaily(
  rows: AdminGenerationDailyRow[],
): AdminGenerationDailySummary[] {
  return rows.map((row, index) => {
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      throw new Error(`generation.daily[${index}].date is invalid`);
    }
    return {
      date: row.date,
      text: toSafeInteger(row.text, `generation.daily[${index}].text`),
      image: toSafeInteger(row.image, `generation.daily[${index}].image`),
      video: toSafeInteger(row.video, `generation.daily[${index}].video`),
      succeeded: toSafeInteger(
        row.succeeded,
        `generation.daily[${index}].succeeded`,
      ),
      failed: toSafeInteger(row.failed, `generation.daily[${index}].failed`),
      canceled: toSafeInteger(
        row.canceled,
        `generation.daily[${index}].canceled`,
      ),
    };
  });
}

function toGenerationFailures(rows: AdminGenerationFailureRow[]) {
  return rows.map((row, index) => {
    if (
      !generationFailureCategories.includes(
        row.category as GenerationFailureCategory,
      )
    ) {
      throw new Error(`generation.failures[${index}].category is invalid`);
    }
    return {
      category: row.category as GenerationFailureCategory,
      count: toSafeInteger(row.count, `generation.failures[${index}].count`),
    };
  });
}

async function readSafeInfrastructure(options: PostgresAdminDashboardOptions) {
  try {
    return await options.readInfrastructureHealth();
  } catch {
    return UNKNOWN_INFRASTRUCTURE;
  }
}

export function createPostgresAdminDashboardService(
  pool: DbPool,
  options: PostgresAdminDashboardOptions,
): AdminDashboardService {
  return {
    async getDashboard(context) {
      await options.adminService.requirePermission(context, "dashboard.read");
      const [result, infrastructure] = await Promise.all([
        pool.query<AdminDashboardRow>(`
          WITH business_clock AS (
            SELECT
              now() AS now_utc,
              timezone('Asia/Shanghai', now())::date AS local_today,
              (timezone('Asia/Shanghai', now())::date::timestamp AT TIME ZONE 'Asia/Shanghai') AS day_start
          ), clock AS (
            SELECT
              now_utc,
              local_today,
              day_start,
              day_start - interval '1 day' AS yesterday_start,
              day_start - interval '1 day' + (now_utc - day_start) AS yesterday_cutoff
            FROM business_clock
          ), user_totals AS (
            SELECT
              count(*) FILTER (WHERE u.status <> 'deleted')::bigint AS registrations_total,
              count(*) FILTER (WHERE u.status <> 'deleted' AND u.created_at >= clock.now_utc - interval '24 hours')::bigint AS registrations_24h,
              count(*) FILTER (WHERE u.status <> 'deleted' AND u.created_at >= clock.now_utc - interval '7 days')::bigint AS registrations_7d,
              count(*) FILTER (WHERE u.status <> 'deleted' AND u.created_at >= clock.day_start AND u.created_at < clock.now_utc)::bigint AS registrations_today,
              count(*) FILTER (WHERE u.status <> 'deleted' AND u.created_at >= clock.yesterday_start AND u.created_at < clock.yesterday_cutoff)::bigint AS registrations_yesterday_same_period,
              count(*) FILTER (WHERE u.status <> 'deleted' AND u.email_verified)::bigint AS verified_users,
              count(*) FILTER (WHERE u.status <> 'deleted' AND NOT u.email_verified)::bigint AS unverified_users,
              count(*) FILTER (WHERE u.status = 'disabled')::bigint AS disabled_users
            FROM public."user" u
            CROSS JOIN clock
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
          ), generation_today AS (
            SELECT
              count(t.user_id)::bigint AS requests,
              count(t.user_id) FILTER (WHERE t.status = 'succeeded')::bigint AS succeeded,
              count(t.user_id) FILTER (WHERE t.status = 'failed')::bigint AS failed,
              count(t.user_id) FILTER (WHERE t.status = 'canceled')::bigint AS canceled,
              COALESCE(sum(t.result_count), 0)::bigint AS results,
              count(DISTINCT t.user_id)::bigint AS active_creators,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY t.duration_ms)
                FILTER (WHERE t.status IN ('succeeded', 'failed')) AS p95_duration_ms
            FROM clock
            LEFT JOIN public.generation_telemetry t
              ON t.started_at >= clock.day_start AND t.started_at < clock.now_utc
          ), generation_yesterday AS (
            SELECT
              count(t.user_id)::bigint AS requests,
              count(t.user_id) FILTER (WHERE t.status = 'succeeded')::bigint AS succeeded,
              count(t.user_id) FILTER (WHERE t.status = 'failed')::bigint AS failed,
              count(t.user_id) FILTER (WHERE t.status = 'canceled')::bigint AS canceled,
              COALESCE(sum(t.result_count), 0)::bigint AS results,
              count(DISTINCT t.user_id)::bigint AS active_creators,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY t.duration_ms)
                FILTER (WHERE t.status IN ('succeeded', 'failed')) AS p95_duration_ms
            FROM clock
            LEFT JOIN public.generation_telemetry t
              ON t.started_at >= clock.yesterday_start AND t.started_at < clock.yesterday_cutoff
          ), generation_days AS (
            SELECT (clock.local_today - series.day_offset)::date AS day
            FROM clock
            CROSS JOIN generate_series(6, 0, -1) AS series(day_offset)
          ), generation_daily AS (
            SELECT
              day.day,
              count(t.user_id) FILTER (WHERE t.category = 'text')::bigint AS text,
              count(t.user_id) FILTER (WHERE t.category = 'image')::bigint AS image,
              count(t.user_id) FILTER (WHERE t.category = 'video')::bigint AS video,
              count(t.user_id) FILTER (WHERE t.status = 'succeeded')::bigint AS succeeded,
              count(t.user_id) FILTER (WHERE t.status = 'failed')::bigint AS failed,
              count(t.user_id) FILTER (WHERE t.status = 'canceled')::bigint AS canceled
            FROM generation_days day
            LEFT JOIN public.generation_telemetry t
              ON t.started_at >= (day.day::timestamp AT TIME ZONE 'Asia/Shanghai')
             AND t.started_at < ((day.day + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
            GROUP BY day.day
          ), generation_failures AS (
            SELECT t.failure_category AS category, count(t.user_id)::bigint AS count
            FROM public.generation_telemetry t
            CROSS JOIN clock
            WHERE t.started_at >= clock.day_start
              AND t.started_at < clock.now_utc
              AND t.status = 'failed'
            GROUP BY t.failure_category
          )
          SELECT
            user_totals.registrations_total,
            user_totals.registrations_24h,
            user_totals.registrations_7d,
            user_totals.registrations_today,
            user_totals.registrations_yesterday_same_period,
            session_totals.active_users_24h,
            session_totals.active_users_7d,
            session_totals.active_sessions,
            asset_totals.storage_used_bytes,
            (asset_totals.asset_reserved_bytes + import_totals.import_reserved_bytes)::bigint AS storage_reserved_bytes,
            workspace_totals.storage_quota_bytes,
            asset_totals.asset_count,
            user_totals.verified_users,
            user_totals.unverified_users,
            user_totals.disabled_users,
            jsonb_build_array(to_jsonb(generation_today)) AS generation_today,
            jsonb_build_array(to_jsonb(generation_yesterday)) AS generation_yesterday_same_period,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'date', to_char(day, 'YYYY-MM-DD'),
                  'text', text,
                  'image', image,
                  'video', video,
                  'succeeded', succeeded,
                  'failed', failed,
                  'canceled', canceled
                ) ORDER BY day
              )
              FROM generation_daily
            ), '[]'::jsonb) AS generation_daily,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object('category', category, 'count', count)
                ORDER BY count DESC, category
              )
              FROM generation_failures
            ), '[]'::jsonb) AS generation_failures
          FROM user_totals, session_totals, asset_totals, workspace_totals,
               import_totals, generation_today, generation_yesterday
        `),
        readSafeInfrastructure(options),
      ]);
      const row = result.rows[0];
      if (!row)
        throw new Error("Administrator dashboard aggregate is unavailable");
      return {
        generatedAt: new Date().toISOString(),
        registrations: {
          total: toSafeInteger(row.registrations_total, "registrations.total"),
          past24Hours: toSafeInteger(
            row.registrations_24h,
            "registrations.past24Hours",
          ),
          past7Days: toSafeInteger(
            row.registrations_7d,
            "registrations.past7Days",
          ),
          today: toSafeInteger(row.registrations_today, "registrations.today"),
          yesterdaySamePeriod: toSafeInteger(
            row.registrations_yesterday_same_period,
            "registrations.yesterdaySamePeriod",
          ),
        },
        activity: {
          activeUsers24Hours: toSafeInteger(
            row.active_users_24h,
            "activity.activeUsers24Hours",
          ),
          activeUsers7Days: toSafeInteger(
            row.active_users_7d,
            "activity.activeUsers7Days",
          ),
          activeSessions: toSafeInteger(
            row.active_sessions,
            "activity.activeSessions",
          ),
        },
        storage: {
          usedBytes: toSafeInteger(row.storage_used_bytes, "storage.usedBytes"),
          reservedBytes: toSafeInteger(
            row.storage_reserved_bytes,
            "storage.reservedBytes",
          ),
          quotaBytes: toSafeInteger(
            row.storage_quota_bytes,
            "storage.quotaBytes",
          ),
          assetCount: toSafeInteger(row.asset_count, "storage.assetCount"),
        },
        authentication: {
          verifiedUsers: toSafeInteger(
            row.verified_users,
            "authentication.verifiedUsers",
          ),
          unverifiedUsers: toSafeInteger(
            row.unverified_users,
            "authentication.unverifiedUsers",
          ),
          disabledUsers: toSafeInteger(
            row.disabled_users,
            "authentication.disabledUsers",
          ),
        },
        generation: {
          timeZone: "Asia/Shanghai",
          today: toGenerationPeriod(row.generation_today, "generation.today"),
          yesterdaySamePeriod: toGenerationPeriod(
            row.generation_yesterday_same_period,
            "generation.yesterdaySamePeriod",
          ),
          daily: toGenerationDaily(row.generation_daily),
          failures: toGenerationFailures(row.generation_failures),
        },
        infrastructure,
      };
    },
  };
}
