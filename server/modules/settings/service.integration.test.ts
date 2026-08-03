import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresCanvasPreferencesService } from "../../dist/modules/settings/service.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test(
  "PostgreSQL canvas settings merge fields and isolate two accounts",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    const schemaName = `canvas_settings_test_${randomUUID().replaceAll("-", "")}`;
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
        .filter((fileName) => fileName.endsWith(".sql"))
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

      await pool.query(`
        INSERT INTO "user" (id, name, email, email_verified, username, display_username)
        VALUES
          ('settings-user-a', 'A', 'settings-a@example.com', true, 'settings_a', 'settings_a'),
          ('settings-user-b', 'B', 'settings-b@example.com', true, 'settings_b', 'settings_b')
      `);
      await pool.query(
        `INSERT INTO workspaces (id, name, owner_user_id)
         VALUES ($1, 'Settings A', 'settings-user-a'), ($2, 'Settings B', 'settings-user-b')`,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, 'settings-user-a', 'owner'), ($2, 'settings-user-b', 'owner')`,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `INSERT INTO workspace_user_state (workspace_id, user_id, ui_state_json)
         VALUES ($1, 'settings-user-a', '{"otherCursor":{"page":2}}'::jsonb)`,
        [WORKSPACE_A],
      );

      const service = createPostgresCanvasPreferencesService(pool);
      const actorA = {
        userId: "settings-user-a",
        workspaceId: WORKSPACE_A,
      };
      const actorB = {
        userId: "settings-user-b",
        workspaceId: WORKSPACE_B,
      };
      assert.deepEqual(await service.get(actorA), {
        settings: null,
        updatedAt: null,
      });

      await service.update({ canvasPerformanceMode: "performance" }, actorA);
      const updatedA = await service.update(
        { lowQualityPreviewEnabled: false },
        actorA,
      );
      assert.equal(updatedA.settings?.canvasPerformanceMode, "performance");
      assert.equal(updatedA.settings?.lowQualityPreviewEnabled, false);
      const raw = await pool.query<{ ui_state_json: Record<string, unknown> }>(
        `SELECT ui_state_json FROM workspace_user_state
         WHERE workspace_id = $1 AND user_id = 'settings-user-a'`,
        [WORKSPACE_A],
      );
      assert.deepEqual(raw.rows[0]?.ui_state_json.otherCursor, { page: 2 });

      assert.deepEqual(await service.get(actorB), {
        settings: null,
        updatedAt: null,
      });
      await service.update({ themeMode: "light" }, actorB);
      assert.equal((await service.get(actorA)).settings?.themeMode, "dark");
      await assert.rejects(
        () =>
          service.get({
            userId: "settings-user-a",
            workspaceId: WORKSPACE_B,
          }),
        (error: unknown) =>
          error instanceof AuthServiceError && error.statusCode === 404,
      );
    } finally {
      await pool?.end();
      if (admin) {
        await admin
          .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .catch(() => undefined);
        await admin.end().catch(() => undefined);
      }
    }
  },
);
