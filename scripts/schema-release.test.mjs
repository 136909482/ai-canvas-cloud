import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  loadSchemaReleaseManifest,
  validateSchemaReleaseManifest,
} from "./check-schema-release.mjs";

test("schema release manifest describes the current baseline and repair", () => {
  const result = validateSchemaReleaseManifest(loadSchemaReleaseManifest());
  assert.deepEqual(result.files, [
    "0001_current_schema.sql",
    "0038_initialize_login_security_settings.sql",
    "0039_add_announcements.sql",
  ]);
  assert.equal(result.manifest.migrations.length, 3);
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
  assert.deepEqual(result.manifest.migrations[1], {
    version: "0038",
    name: "initialize_login_security_settings",
    releaseTrain: "admin-login-security-default",
    phase: "migrate",
    oldAppReadable: true,
    newAppReadable: true,
    oldAppWithNewSchema: true,
    lockRisk: "low",
    statementTimeoutMs: 30000,
    rollback: "delete the singleton only before any Admin traffic is served",
    forwardRepair:
      "rerun the idempotent singleton insert and verify the CAPTCHA endpoint",
    backupRequired: false,
  });
  assert.deepEqual(result.manifest.migrations[2], {
    version: "0039",
    name: "add_announcements",
    releaseTrain: "in-app-announcement-timeline",
    phase: "expand",
    oldAppReadable: true,
    newAppReadable: true,
    oldAppWithNewSchema: true,
    lockRisk: "low",
    statementTimeoutMs: 30000,
    rollback:
      "drop announcement_receipts and announcements only before any announcement is published",
    forwardRepair:
      "rerun the idempotent role provisioning after applying the announcement tables",
    backupRequired: false,
  });
});

test("announcement migration adds a bounded timeline and per-user receipts", async () => {
  const sql = await readFile(
    join(
      process.cwd(),
      "server",
      "db",
      "migrations",
      "0039_add_announcements.sql",
    ),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE public\.announcements/);
  assert.match(sql, /CREATE TABLE public\.announcement_receipts/);
  assert.match(sql, /PRIMARY KEY \(announcement_id, user_id\)/);
  assert.match(sql, /WHERE status = 'published'/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|DATABASE)/i);
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
  assert.match(
    sql,
    /INSERT INTO admin\.login_security_settings \(singleton_id, captcha_enabled\)/,
  );
  assert.doesNotMatch(sql, /\btask_count\b/);
  assert.doesNotMatch(sql, /\btask_quota_monthly\b/);
});

test("login security repair is idempotent and preserves an existing setting", async () => {
  const sql = await readFile(
    join(
      process.cwd(),
      "server",
      "db",
      "migrations",
      "0038_initialize_login_security_settings.sql",
    ),
    "utf8",
  );
  assert.match(sql, /VALUES \(1, false\)/);
  assert.match(sql, /ON CONFLICT \(singleton_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /UPDATE|DELETE/i);
});
