import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import type { AdminService } from "./service.ts";
import { createPostgresAdminDashboardService } from "./dashboardService.ts";

const aggregateRow = {
  registrations_total: "120",
  registrations_24h: "4",
  registrations_7d: "23",
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
  assert.deepEqual(result.infrastructure, {
    postgres: { ok: true, latencyMs: 7 },
    objectStorage: { ok: false, latencyMs: 11, error: "bucket_unavailable" },
  });
  assert.match(aggregateSql, /count\(DISTINCT s\.user_id\)/);
  assert.match(aggregateSql, /committed_asset_id IS NULL/);
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
