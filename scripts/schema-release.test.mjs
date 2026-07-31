import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  loadSchemaReleaseManifest,
  validateSchemaReleaseManifest,
} from "./check-schema-release.mjs";

test("schema release manifest describes the single current baseline", () => {
  const result = validateSchemaReleaseManifest(loadSchemaReleaseManifest());
  assert.deepEqual(result.files, ["0001_current_schema.sql"]);
  assert.equal(result.manifest.migrations.length, 1);
  assert.deepEqual(result.manifest.migrations[0], {
    version: "0001",
    name: "current_schema",
    releaseTrain: "initial-production-baseline",
    phase: "expand",
    oldAppReadable: false,
    newAppReadable: true,
    oldAppWithNewSchema: false,
    lockRisk: "low",
    statementTimeoutMs: 300000,
    rollback: "recreate the unopened database before production launch",
    forwardRepair:
      "recreate the unopened database and rerun the current baseline",
    backupRequired: false,
  });
});

test("current baseline is nonempty and excludes psql-only or destructive database commands", async () => {
  const sql = await readFile(
    join(
      process.cwd(),
      "server",
      "db",
      "migrations",
      "0001_current_schema.sql",
    ),
    "utf8",
  );
  assert.ok(sql.trim().length > 0);
  assert.doesNotMatch(sql, /\\(?:un)?restrict\b/);
  assert.doesNotMatch(sql, /\bDROP\s+DATABASE\b/i);
  assert.match(sql, /CREATE TABLE public\.projects/);
  assert.match(sql, /CREATE TABLE admin\.smtp_config_revisions/);
  assert.doesNotMatch(sql, /\btask_count\b/);
  assert.doesNotMatch(sql, /\btask_quota_monthly\b/);
});
