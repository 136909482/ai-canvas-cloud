import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import type { AdminService } from "./service.ts";
import { createPostgresAdminDashboardService } from "./dashboardService.ts";

const aggregateRow = {
  registrations_total: "120",
  registrations_24h: "4",
  registrations_7d: "23",
  registrations_today: "3",
  registrations_yesterday_same_period: "2",
  active_users_24h: "19",
  active_users_7d: "58",
  active_sessions: "21",
  storage_used_bytes: "4096",
  storage_reserved_bytes: "768",
  storage_quota_bytes: "32768",
  asset_count: "42",
  verified_users: "101",
  unverified_users: "18",
  disabled_users: "3",
  generation_today: [
    {
      requests: 18,
      succeeded: 14,
      failed: 2,
      canceled: 1,
      results: 16,
      active_creators: 7,
      p95_duration_ms: 12_345.4,
    },
  ],
  generation_yesterday_same_period: [
    {
      requests: 12,
      succeeded: 8,
      failed: 2,
      canceled: 1,
      results: 9,
      active_creators: 5,
      p95_duration_ms: 10_000,
    },
  ],
  generation_daily: [
    {
      date: "2026-07-24",
      text: 4,
      image: 6,
      video: 2,
      succeeded: 9,
      failed: 2,
      canceled: 1,
    },
    {
      date: "2026-07-25",
      text: 7,
      image: 9,
      video: 2,
      succeeded: 14,
      failed: 2,
      canceled: 1,
    },
  ],
  generation_failures: [
    { category: "network", count: 1 },
    { category: "asset_upload", count: 1 },
  ],
};

function adminService() {
  return {
    async requirePermission(_context: unknown, permission: string) {
      assert.equal(permission, "dashboard.read");
      return {
        admin: {
          id: "admin-01",
          username: "auditor",
          role: "auditor" as const,
          status: "active" as const,
        },
        expiresAt: "2026-07-24T00:00:00.000Z",
      };
    },
  } as Pick<AdminService, "requirePermission">;
}

test("administrator dashboard returns bounded aggregate metrics and dependency health", async () => {
  let aggregateSql = "";
  const pool = {
    async query(sql: string) {
      aggregateSql = sql;
      return { rows: [aggregateRow], rowCount: 1 };
    },
  } as unknown as DbPool;
  const service = createPostgresAdminDashboardService(pool, {
    adminService: adminService(),
    async readInfrastructureHealth() {
      return {
        postgres: { ok: true, latencyMs: 7 },
        objectStorage: {
          ok: false,
          latencyMs: 11,
          error: "bucket_unavailable" as const,
        },
      };
    },
  });

  const result = await service.getDashboard({ requestId: "dashboard-request" });
  assert.equal(Number.isFinite(Date.parse(result.generatedAt)), true);
  assert.deepEqual(result.registrations, {
    total: 120,
    past24Hours: 4,
    past7Days: 23,
    today: 3,
    yesterdaySamePeriod: 2,
  });
  assert.deepEqual(result.activity, {
    activeUsers24Hours: 19,
    activeUsers7Days: 58,
    activeSessions: 21,
  });
  assert.deepEqual(result.storage, {
    usedBytes: 4096,
    reservedBytes: 768,
    quotaBytes: 32768,
    assetCount: 42,
  });
  assert.deepEqual(result.authentication, {
    verifiedUsers: 101,
    unverifiedUsers: 18,
    disabledUsers: 3,
  });
  assert.deepEqual(result.generation, {
    timeZone: "Asia/Shanghai",
    today: {
      requests: 18,
      succeeded: 14,
      failed: 2,
      canceled: 1,
      results: 16,
      activeCreators: 7,
      successRate: 87.5,
      p95DurationMs: 12_345,
    },
    yesterdaySamePeriod: {
      requests: 12,
      succeeded: 8,
      failed: 2,
      canceled: 1,
      results: 9,
      activeCreators: 5,
      successRate: 80,
      p95DurationMs: 10_000,
    },
    daily: aggregateRow.generation_daily,
    failures: aggregateRow.generation_failures,
  });
  assert.deepEqual(result.infrastructure, {
    postgres: { ok: true, latencyMs: 7 },
    objectStorage: { ok: false, latencyMs: 11, error: "bucket_unavailable" },
  });
  assert.match(aggregateSql, /count\(DISTINCT s\.user_id\)/);
  assert.match(aggregateSql, /committed_asset_id IS NULL/);
  assert.match(aggregateSql, /Asia\/Shanghai/);
  assert.match(aggregateSql, /public\.generation_telemetry/);
  assert.doesNotMatch(aggregateSql, /count\(t\.id\)/);
  assert.match(
    aggregateSql,
    /generate_series\(6, 0, -1\) AS series\(day_offset\)/,
  );
  assert.doesNotMatch(
    aggregateSql,
    /object_key|data_json|presentation_json|\bs\.token\b/i,
  );
});

test("administrator dashboard collapses infrastructure reader failures to unknown categories", async () => {
  const pool = {
    async query() {
      return { rows: [aggregateRow], rowCount: 1 };
    },
  } as unknown as DbPool;
  const service = createPostgresAdminDashboardService(pool, {
    adminService: adminService(),
    async readInfrastructureHealth() {
      throw new Error("sensitive infrastructure failure");
    },
  });

  const result = await service.getDashboard({
    requestId: "dashboard-health-failure",
  });
  assert.deepEqual(result.infrastructure, {
    postgres: { ok: false, latencyMs: 0, error: "unknown" },
    objectStorage: { ok: false, latencyMs: 0, error: "unknown" },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /sensitive infrastructure failure/,
  );
});
