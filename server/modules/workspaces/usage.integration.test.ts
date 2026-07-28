import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import {
  DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES,
  createPostgresWorkspaceUsageService,
} from "../../dist/modules/workspaces/usage.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A_EMPTY = "22222222-2222-4222-8222-222222222222";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";

test(
  "PostgreSQL workspace usage is status-aware and isolates two accounts",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `workspace_usage_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

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
        .filter(
          (fileName) =>
            fileName.endsWith(".sql") &&
            !/^(?:002[5-9]|0030|003[235])_/.test(fileName),
        )
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
      }

      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('usage-user-a', 'A', 'usage-a@example.com', true),
        ('usage-user-b', 'B', 'usage-b@example.com', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ($1, 'Usage A', 'usage-user-a'),
        ($2, 'Usage B', 'usage-user-b')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'usage-user-a', 'owner'),
        ($2, 'usage-user-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO projects (id, workspace_id, name, node_count)
      VALUES
        ($1, $4, 'Usage project A', 7),
        ($2, $4, 'Empty project A', 2),
        ($3, $5, 'Usage project B', 1)
    `,
        [PROJECT_A, PROJECT_A_EMPTY, PROJECT_B, WORKSPACE_A, WORKSPACE_B],
      );

      const rows = [
        [WORKSPACE_A, PROJECT_A, "usage-user-a", 100, "completed"],
        [WORKSPACE_A, PROJECT_A, "usage-user-a", 50, "pending"],
        [WORKSPACE_A, PROJECT_A, "usage-user-a", 25, "failed"],
        [WORKSPACE_A, PROJECT_A, "usage-user-a", 10, "quarantined"],
        [WORKSPACE_A, PROJECT_A, "usage-user-a", 999, "deleted"],
        [WORKSPACE_B, PROJECT_B, "usage-user-b", 1000, "completed"],
      ] as const;
      for (const [
        index,
        [workspaceId, projectId, userId, byteSize, status],
      ] of rows.entries()) {
        await pool.query(
          `
        INSERT INTO assets (
          workspace_id, origin_project_id, created_by_user_id, object_key, original_file_name,
          mime_type, byte_size, asset_kind, status, deleted_at
        ) VALUES (
          $1, $2, $3, $4, 'usage.png', 'image/png', $5, 'upload', $6,
          CASE WHEN $6 = 'deleted' THEN now() ELSE NULL END
        )
      `,
          [
            workspaceId,
            projectId,
            userId,
            `workspaces/${workspaceId}/usage/${index}.png`,
            byteSize,
            status,
          ],
        );
      }

      const service = createPostgresWorkspaceUsageService(pool);
      const usageA = await service.getCurrentUsage({
        userId: "usage-user-a",
        workspaceId: WORKSPACE_A,
      });
      assert.equal(usageA.workspaceId, WORKSPACE_A);
      assert.deepEqual(usageA.storage, {
        usedBytes: 135,
        reservedBytes: 50,
        totalBytes: 185,
        quotaBytes: DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES,
        availableBytes: DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES - 185,
      });
      assert.deepEqual(
        usageA.projects.map((project) => ({
          projectId: project.projectId,
          name: project.name,
          fileCount: project.fileCount,
          nodeCount: project.nodeCount,
          storageBytes: project.storageBytes,
        })),
        [
          {
            projectId: PROJECT_A,
            name: "Usage project A",
            fileCount: 4,
            nodeCount: 7,
            storageBytes: 185,
          },
          {
            projectId: PROJECT_A_EMPTY,
            name: "Empty project A",
            fileCount: 0,
            nodeCount: 2,
            storageBytes: 0,
          },
        ],
      );

      const usageB = await service.getCurrentUsage({
        userId: "usage-user-b",
        workspaceId: WORKSPACE_B,
      });
      assert.equal(usageB.storage.usedBytes, 1000);
      assert.equal(usageB.storage.reservedBytes, 0);
      assert.deepEqual(
        usageB.projects.map((project) => project.projectId),
        [PROJECT_B],
      );

      await assert.rejects(
        () =>
          service.getCurrentUsage({
            userId: "usage-user-a",
            workspaceId: WORKSPACE_B,
          }),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
