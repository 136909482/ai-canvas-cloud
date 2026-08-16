import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresGenerationTaskRecordService } from "../../dist/modules/generation-task-records/service.js";
import { createWorkspaceAuthorizationService } from "../../dist/modules/workspaces/authorization.js";

loadDotEnv();
const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL generation task records isolate accounts and upsert by client task",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    const schemaName = `task_record_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
    const userIdA = "task-record-user-a";
    const userIdB = "task-record-user-b";
    const workspaceIdA = randomUUID();
    const workspaceIdB = randomUUID();
    const clientTaskId = randomUUID();
    const assetId = randomUUID();
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
        options: `-c search_path=${schemaName},public`,
      });
      const migrationFiles = (
        await readdir(join(process.cwd(), "server", "db", "migrations"))
      )
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          isolateCurrentSchemaSql(
            await readFile(
              join(process.cwd(), "server", "db", "migrations", fileName),
              "utf8",
            ),
            schemaName,
          ),
        );
      }
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, user_no, username, display_username)
         VALUES ($1, 'A', 'task-record-a@example.com', true, 11001, 'task_record_a', 'task_record_a'),
                ($2, 'B', 'task-record-b@example.com', true, 11002, 'task_record_b', 'task_record_b')`,
        [userIdA, userIdB],
      );
      await pool.query(
        `INSERT INTO workspaces (id, name, owner_user_id)
         VALUES ($1, 'A workspace', $2), ($3, 'B workspace', $4)`,
        [workspaceIdA, userIdA, workspaceIdB, userIdB],
      );
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
        [workspaceIdA, userIdA, workspaceIdB, userIdB],
      );

      const authorizationService = createWorkspaceAuthorizationService(pool);
      const service = createPostgresGenerationTaskRecordService(pool, {
        authorizationService,
      });
      const actorA = { userId: userIdA, workspaceId: workspaceIdA };
      const actorB = { userId: userIdB, workspaceId: workspaceIdB };

      const input = {
        clientTaskId,
        title: "图像生成 #abc123",
        category: "image" as const,
        status: "succeeded" as const,
        resultCount: 1,
        durationMs: 1500,
        modelEntryId: null,
        assetIds: [assetId],
        startedAt: "2026-08-15T10:00:00.000Z",
        completedAt: "2026-08-15T10:00:01.500Z",
      };
      assert.deepEqual(await service.record(input, actorA), {
        accepted: true,
      });
      const pageA = await service.listMine(actorA);
      assert.equal(pageA.items.length, 1);
      assert.equal(pageA.items[0]?.title, "图像生成 #abc123");
      assert.equal(pageA.items[0]?.assetIds.join(","), assetId);
      assert.equal(pageA.nextCursor, null);
      // 用户 B 不可见（隔离）
      assert.equal((await service.listMine(actorB)).items.length, 0);

      // 相同 clientTaskId 幂等更新
      await service.record(
        {
          ...input,
          title: "图像生成 #def456",
          status: "failed",
          failureCategory: "network",
          resultCount: 0,
          assetIds: [],
        },
        actorA,
      );
      const afterUpdate = await service.listMine(actorA);
      assert.equal(afterUpdate.items.length, 1);
      assert.equal(afterUpdate.items[0]?.title, "图像生成 #def456");
      assert.equal(afterUpdate.items[0]?.status, "failed");
      assert.equal(afterUpdate.items[0]?.failureCategory, "network");

      // 用户 B 无权读取 A 的记录，也不能跨账号伪造（404 不暴露存在性）
      assert.equal((await service.listMine(actorB)).items.length, 0);
      await assert.rejects(
        () =>
          service.record(
            { ...input, clientTaskId: randomUUID() },
            { userId: userIdB, workspaceId: workspaceIdA },
          ),
        (error: unknown) =>
          error instanceof AuthServiceError && error.statusCode === 404,
      );
    } finally {
      await pool?.end();
      await admin
        .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  },
);
