import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import type { AdminService } from "./service.ts";
import { createPostgresAdminUserOperationsService } from "./userOperationsService.ts";

test("administrator user ban, unban, and session revocation are transactional and audited", async () => {
  const now = "2026-07-23T01:00:00.000Z";
  const state = {
    status: "active" as "active" | "disabled" | "deleted",
    sessions: ["session-1", "session-2"],
    audits: [] as unknown[][],
  };
  const summary = () => ({
    id: "user_01",
    user_no: "10001",
    name: "Artist",
    email: "artist@example.com",
    email_verified: true,
    status: state.status,
    workspace_count: "0",
    storage_used_bytes: "0",
    active_session_count: String(state.sessions.length),
    last_active_at: state.sessions.length ? now : null,
    created_at: now,
    updated_at: now,
  });
  const database = {
    async query(sql: string, values: unknown[] = []) {
      if (/^(?:BEGIN|COMMIT|ROLLBACK)$/.test(sql))
        return { rows: [], rowCount: null };
      if (sql.includes("SELECT status") && sql.includes("FOR UPDATE")) {
        return { rows: [{ status: state.status }], rowCount: 1 };
      }
      if (
        sql.includes('UPDATE public."user"') &&
        sql.includes("status = 'disabled'")
      ) {
        state.status = "disabled";
        return { rows: [], rowCount: 1 };
      }
      if (
        sql.includes('UPDATE public."user"') &&
        sql.includes("status = 'active'")
      ) {
        state.status = "active";
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM public."session"')) {
        const rows = state.sessions.map((id) => ({ id }));
        state.sessions = [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("INSERT INTO admin.audit_events")) {
        state.audits.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("WITH workspace_usage AS"))
        return { rows: [summary()], rowCount: 1 };
      if (sql.includes("SELECT") && sql.includes("w.id::text"))
        return { rows: [], rowCount: 0 };
      throw new Error(
        `Unexpected administrator user operations SQL: ${sql.replace(/\s+/g, " ").trim().slice(0, 120)}`,
      );
    },
    async connect() {
      return { query: this.query.bind(this), release() {} };
    },
  } as unknown as DbPool;
  const adminSession = {
    admin: {
      id: "admin-01",
      username: "support",
      role: "support" as const,
      status: "active" as const,
    },
    expiresAt: "2026-07-24T01:00:00.000Z",
  };
  const adminService = {
    async requirePermission(_context: unknown, permission: string) {
      assert.equal(["user.read", "user.write"].includes(permission), true);
      return adminSession;
    },
  } as Pick<AdminService, "requirePermission">;
  const service = createPostgresAdminUserOperationsService(database, {
    adminService,
    auditSecret: "administrator-audit-secret-for-tests",
  });
  const context = {
    requestId: "request-01",
    ipAddress: "192.0.2.10",
    userAgent: "Test Agent",
  };

  const banned = await service.banUser(
    "user_01",
    { reason: "  风险复核  " },
    context,
  );
  assert.equal(banned.user.status, "disabled");
  assert.equal(banned.revokedSessionCount, 2);
  state.sessions.push("late-session");
  const bannedAgain = await service.banUser(
    "user_01",
    { reason: "处理迟到登录" },
    context,
  );
  assert.equal(bannedAgain.revokedSessionCount, 1);
  assert.deepEqual(state.sessions, []);

  const unbanned = await service.unbanUser(
    "user_01",
    { reason: "身份复核通过" },
    context,
  );
  assert.equal(unbanned.user.status, "active");
  state.sessions.push("session-3");
  const revoked = await service.revokeUserSessions(
    "user_01",
    { reason: "用户请求退出全部设备" },
    context,
  );
  assert.equal(revoked.revokedSessionCount, 1);
  assert.deepEqual(state.sessions, []);

  assert.deepEqual(
    state.audits.map((values) => values[2]),
    ["user.ban", "user.ban", "user.unban", "user.sessions.revoke"],
  );
  const serializedAudit = JSON.stringify(state.audits);
  assert.match(
    serializedAudit,
    /风险复核|处理迟到登录|身份复核通过|用户请求退出全部设备/,
  );
  assert.doesNotMatch(
    serializedAudit,
    /artist@example\.com|late-session|session-3/,
  );
  for (const values of state.audits) {
    assert.match(String(values[7]), /^[0-9a-f]{64}$/);
    assert.match(String(values[8]), /^[0-9a-f]{64}$/);
  }
});

test("administrator user queries keep two accounts isolated across filters, cursor pages, and details", async () => {
  const queryCalls: Array<{ sql: string; values: unknown[] }> = [];
  let listCalls = 0;
  const row = (id: "user_A" | "user_B") => ({
    id,
    user_no: id === "user_A" ? "10001" : "10002",
    name: id === "user_A" ? "Alpha" : "Beta",
    email: id === "user_A" ? "alpha@example.com" : "beta@example.com",
    email_verified: id === "user_A",
    status: id === "user_A" ? ("active" as const) : ("disabled" as const),
    workspace_count: "1",
    storage_used_bytes: id === "user_A" ? "111" : "222",
    active_session_count: id === "user_A" ? "1" : "0",
    last_active_at: id === "user_A" ? "2026-07-23T03:00:00.000Z" : null,
    created_at:
      id === "user_A" ? "2026-07-23T03:00:00.000Z" : "2026-07-23T02:00:00.000Z",
    updated_at: "2026-07-23T04:00:00.000Z",
  });
  const database = {
    async query(sql: string, values: unknown[] = []) {
      queryCalls.push({ sql, values });
      if (
        sql.includes("WITH workspace_usage AS") &&
        !sql.includes("WHERE u.id = $1")
      ) {
        listCalls += 1;
        return listCalls === 1
          ? { rows: [row("user_A"), row("user_B")], rowCount: 2 }
          : { rows: [row("user_B")], rowCount: 1 };
      }
      if (
        sql.includes("WITH workspace_usage AS") &&
        sql.includes("WHERE u.id = $1")
      ) {
        const userId = values[0] as "user_A" | "user_B";
        return { rows: [row(userId)], rowCount: 1 };
      }
      if (sql.includes("w.id::text")) {
        const userId = values[0] as "user_A" | "user_B";
        return {
          rows: [
            {
              id: `workspace_${userId.at(-1)}`,
              name: `${userId} workspace`,
              type: "personal",
              role: "owner",
              status: "active",
              plan_key: "free",
              storage_quota_bytes: "1000",
              storage_used_bytes: userId === "user_A" ? "111" : "222",
              storage_reserved_bytes: "0",
              created_at: "2026-07-20T00:00:00.000Z",
              updated_at: "2026-07-23T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error("Unexpected query");
    },
  } as unknown as DbPool;
  const adminService = {
    async requirePermission(_context: unknown, permission: string) {
      assert.equal(permission, "user.read");
      return {
        admin: {
          id: "admin-01",
          username: "support",
          role: "support" as const,
          status: "active" as const,
        },
        expiresAt: "2026-07-24T00:00:00.000Z",
      };
    },
  } as Pick<AdminService, "requirePermission">;
  const service = createPostgresAdminUserOperationsService(database, {
    adminService,
    auditSecret: "administrator-audit-secret-for-tests",
  });
  const context = { requestId: "query-request" };

  const first = await service.listUsers({ limit: 1 }, context);
  assert.deepEqual(
    first.items.map((user) => user.id),
    ["user_A"],
  );
  assert.equal(typeof first.nextCursor, "string");
  const second = await service.listUsers(
    {
      cursor: first.nextCursor,
      limit: 1,
      status: "disabled",
      verification: "unverified",
      search: "BETA",
    },
    context,
  );
  assert.deepEqual(
    second.items.map((user) => user.id),
    ["user_B"],
  );
  assert.equal(second.nextCursor, null);
  assert.deepEqual(queryCalls[1]!.values.slice(2), [
    "disabled",
    false,
    "beta",
    2,
  ]);

  const alpha = await service.getUser("user_A", context);
  const beta = await service.getUser("user_B", context);
  assert.equal(alpha.user.storageUsedBytes, 111);
  assert.equal(alpha.workspaces[0]?.id, "workspace_A");
  assert.equal(beta.user.storageUsedBytes, 222);
  assert.equal(beta.workspaces[0]?.id, "workspace_B");
  assert.doesNotMatch(
    JSON.stringify(alpha),
    /user_B|workspace_B|beta@example\.com/,
  );
  assert.doesNotMatch(
    JSON.stringify(beta),
    /user_A|workspace_A|alpha@example\.com/,
  );
  assert.deepEqual(
    queryCalls.slice(-4).map((call) => call.values),
    [["user_A"], ["user_A"], ["user_B"], ["user_B"]],
  );
});
