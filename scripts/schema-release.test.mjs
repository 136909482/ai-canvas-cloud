import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "@ai-canvas-cloud/server";
import {
  loadSchemaReleaseManifest,
  validateSchemaReleaseManifest,
} from "./check-schema-release.mjs";

test("schema release manifest covers every migration with monotonic release phases", () => {
  const result = validateSchemaReleaseManifest(loadSchemaReleaseManifest());
  assert.equal(result.files.length, 31);
  assert.equal(result.manifest.migrations.at(-1).version, "0031");
  assert.equal(result.manifest.migrations.at(-1).releaseTrain, "p8-operations");
  assert.equal(result.manifest.migrations.at(-1).phase, "expand");
  assert.equal(result.manifest.migrations.at(-1).oldAppWithNewSchema, true);
  assert.equal(
    result.manifest.migrations.filter((migration) => migration.backupRequired)
      .length > 0,
    true,
  );
});

loadDotEnv();
const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

test(
  "migration interruption rollback and rerun leave a known schema version",
  {
    skip: migrationDatabaseUrl
      ? false
      : "MIGRATION_DATABASE_URL or DATABASE_URL is not configured",
  },
  async () => {
    const schema = `schema_release_${randomUUID().replaceAll("-", "")}`;
    const client = new pg.Client({ connectionString: migrationDatabaseUrl });
    let adminSchemaExisted = true;
    const migrationFiles = (
      await readdir(join(process.cwd(), "server", "db", "migrations"))
    )
      .filter((name) => name.endsWith(".sql"))
      .sort();
    try {
      await client.connect();
      const adminSchema = await client.query(
        `SELECT 1 FROM pg_namespace WHERE nspname = 'admin'`,
      );
      adminSchemaExisted = adminSchema.rowCount > 0;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const fileName of migrationFiles.slice(0, -1)) {
        await client.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
        const [, version, name] = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(fileName);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [version, name],
        );
      }
      const newAppOnOldSchema = await client.query(
        "SELECT id, status, completed_file_count FROM migration_exports",
      );
      assert.deepEqual(
        newAppOnOldSchema.fields.map((field) => field.name),
        ["id", "status", "completed_file_count"],
      );
      const oldAppOnNewSchemaShape = await client.query(
        "SELECT id, status, completed_file_count FROM migration_exports",
      );
      assert.deepEqual(
        oldAppOnNewSchemaShape.fields.map((field) => field.name),
        ["id", "status", "completed_file_count"],
      );
      const finalFileName = migrationFiles.at(-1);
      const finalSql = await readFile(
        join(process.cwd(), "server", "db", "migrations", finalFileName),
        "utf8",
      );
      const [, finalVersion, finalName] = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(
        finalFileName,
      );
      await client.query("BEGIN");
      await client.query(finalSql);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(finalSql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [finalVersion, finalName],
      );
      await client.query("COMMIT");
      const applied = await client.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      assert.equal(applied.rowCount, migrationFiles.length);
      assert.equal(applied.rows.at(-1)?.version, finalVersion);
      const retryColumn = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'migration_exports' AND column_name = 'retry_count'`,
        [schema],
      );
      assert.equal(retryColumn.rowCount, 1);
      const userNumberColumn = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'user' AND column_name = 'user_no'`,
        [schema],
      );
      assert.equal(userNumberColumn.rowCount, 1);
      const usernameColumns = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'user' AND column_name = ANY($2::text[])`,
        [schema, ["username", "display_username"]],
      );
      assert.equal(usernameColumns.rowCount, 2);
      const adminUsernameColumn = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'admin' AND table_name = 'user' AND column_name = 'username'`,
      );
      assert.equal(adminUsernameColumn.rowCount, 1);
      const adminCaptchaSettings = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'admin' AND table_name = 'login_security_settings'`,
      );
      assert.equal(adminCaptchaSettings.rowCount, 1);
      const generationTelemetryTable = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'generation_telemetry'`,
        [schema],
      );
      assert.equal(generationTelemetryTable.rowCount, 1);
      const removedTables = await client.query(
        `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[])
    `,
        [
          schema,
          [
            "generation_tasks",
            "task_attempts",
            "task_commands",
            "task_queue_outbox",
            "generation_task_events",
            "usage_ledger",
            "provider_credentials",
          ],
        ],
      );
      assert.equal(removedTables.rowCount, 0);
      const taskReferenceColumn = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'asset_references' AND column_name = 'task_id'`,
        [schema],
      );
      assert.equal(taskReferenceColumn.rowCount, 0);
      const insertedUser = await client.query(
        `INSERT INTO "user" (id, name, username, display_username, email)
         VALUES ('schema-release-user', 'Schema_User', 'schema_user', 'Schema_User', 'schema-release@example.invalid')
         RETURNING user_no`,
      );
      assert.equal(Number(insertedUser.rows[0]?.user_no), 10001);
    } finally {
      if (client.readyForQuery) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query("SET search_path TO public").catch(() => undefined);
        await client
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => undefined);
        if (!adminSchemaExisted)
          await client
            .query("DROP SCHEMA IF EXISTS admin CASCADE")
            .catch(() => undefined);
      }
      await client.end();
    }
  },
);
