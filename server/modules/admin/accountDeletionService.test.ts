import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import { AdminAccessError } from "./security.ts";
import { createPostgresAdminAccountDeletionService } from "./accountDeletionService.ts";

const context = { requestId: "account-deletion-test" };

function adminService(permissionCalls: string[]) {
  return {
    async requirePermission(_context: unknown, permission: string) {
      permissionCalls.push(permission);
      return {
        admin: {
          id: "admin-1",
          username: "root",
          role: "super_admin" as const,
          status: "active" as const,
        },
        expiresAt: "2026-08-01T00:00:00.000Z",
      };
    },
  };
}

test("account deletion preview is permission-gated and exposes only active team successors", async () => {
  const permissionCalls: string[] = [];
  const database = {
    async query(sql: string) {
      if (sql.includes('FROM public."user"')) {
        return {
          rows: [
            {
              id: "user-1",
              user_no: "10001",
              email: "person@example.com",
              status: "active",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("personal_workspace_count")) {
        return {
          rows: [{ personal_workspace_count: "1", team_membership_count: "2" }],
          rowCount: 1,
        };
      }
      if (sql.includes("owner_user_id") && sql.includes("type = 'team'")) {
        return {
          rows: [
            { id: "11111111-1111-4111-8111-111111111111", name: "Studio" },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("wm.workspace_id = ANY")) {
        return {
          rows: [
            {
              workspace_id: "11111111-1111-4111-8111-111111111111",
              id: "member-1",
              user_no: "10002",
              display_username: "Member_1",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 48)}`);
    },
  } as unknown as DbPool;
  const service = createPostgresAdminAccountDeletionService(database, {
    adminService: adminService(permissionCalls),
    auditSecret: "audit-secret-for-account-deletion-tests",
    ordinaryAuthSecret: "ordinary-auth-secret-for-account-deletion-tests",
  });

  assert.deepEqual(await service.getDeletionPreview("user-1", context), {
    userId: "user-1",
    userNumber: 10001,
    personalWorkspaceCount: 1,
    teamMembershipCount: 2,
    ownedTeams: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Studio",
        successors: [
          { id: "member-1", userNumber: 10002, username: "Member_1" },
        ],
      },
    ],
  });
  assert.deepEqual(permissionCalls, ["user.delete"]);
});

test("account deletion rejects repeat requests and missing owner transfers before mutation", async () => {
  const permissionCalls: string[] = [];
  const deletedDatabase = {
    async query(sql: string) {
      if (/^(?:BEGIN|COMMIT|ROLLBACK)$/.test(sql))
        return { rows: [], rowCount: null };
      if (sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "user-1",
              user_no: "10001",
              email: "person@example.com",
              status: "deleted",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error("Unexpected SQL");
    },
    async connect() {
      return { query: this.query.bind(this), release() {} };
    },
  } as unknown as DbPool;
  const service = createPostgresAdminAccountDeletionService(deletedDatabase, {
    adminService: adminService(permissionCalls),
    auditSecret: "audit-secret-for-account-deletion-tests",
    ordinaryAuthSecret: "ordinary-auth-secret-for-account-deletion-tests",
  });
  await assert.rejects(
    () =>
      service.deleteUser(
        "user-1",
        {
          reason: "已确认需要注销",
          confirmUserNumber: 10001,
          ownershipTransfers: [],
        },
        context,
      ),
    (error: unknown) =>
      error instanceof AdminAccessError &&
      error.code === "USER_DELETION_ALREADY_REQUESTED",
  );
  assert.deepEqual(permissionCalls, ["user.delete"]);
});

test("account deletion rolls back before mutation when confirmation or owner transfer is invalid", async () => {
  const permissionCalls: string[] = [];
  const transactionCommands: string[] = [];
  const query = async (sql: string) => {
    if (/^(?:BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      transactionCommands.push(sql);
      return { rows: [], rowCount: null };
    }
    if (sql.includes('FROM public."user"') && sql.includes("FOR UPDATE")) {
      return {
        rows: [
          {
            id: "user-1",
            user_no: "10001",
            email: "person@example.com",
            status: "active",
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("type = 'personal'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("type = 'team'")) {
      return {
        rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Studio" }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 64)}`);
  };
  const database = {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as DbPool;
  const service = createPostgresAdminAccountDeletionService(database, {
    adminService: adminService(permissionCalls),
    auditSecret: "audit-secret-for-account-deletion-tests",
    ordinaryAuthSecret: "ordinary-auth-secret-for-account-deletion-tests",
  });

  await assert.rejects(
    () =>
      service.deleteUser(
        "user-1",
        {
          reason: "确认号码错误",
          confirmUserNumber: 10002,
          ownershipTransfers: [],
        },
        context,
      ),
    (error: unknown) =>
      error instanceof AdminAccessError &&
      error.code === "USER_DELETION_CONFIRMATION_MISMATCH",
  );
  assert.deepEqual(transactionCommands, ["BEGIN", "ROLLBACK"]);

  transactionCommands.length = 0;
  await assert.rejects(
    () =>
      service.deleteUser(
        "user-1",
        {
          reason: "缺少团队接任人",
          confirmUserNumber: 10001,
          ownershipTransfers: [],
        },
        context,
      ),
    (error: unknown) =>
      error instanceof AdminAccessError &&
      error.code === "TEAM_OWNERSHIP_TRANSFER_REQUIRED",
  );
  assert.deepEqual(transactionCommands, ["BEGIN", "ROLLBACK"]);
  assert.deepEqual(permissionCalls, ["user.delete", "user.delete"]);
});
