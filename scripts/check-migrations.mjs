import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const migrationsDir = join(process.cwd(), "server", "db", "migrations");
const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function readDotEnv() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] ??= value.replace(/^"(.*)"$/, "$1");
  }
}

function loadMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  assert.deepEqual(files, [
    "0001_current_schema.sql",
    "0038_initialize_login_security_settings.sql",
    "0039_add_announcements.sql",
    "0040_add_asset_quota_release.sql",
    "0041_add_user_public_profiles.sql",
    "0042_add_community_content.sql",
    "0043_add_generation_task_records.sql",
    "0044_add_official_generation_credits.sql",
    "0045_fix_official_admin_id_types.sql",
  ]);
  return files.map((fileName) => {
    const match = migrationPattern.exec(fileName);
    assert.ok(match);
    const sql = readFileSync(join(migrationsDir, fileName), "utf8").trim();
    assert.ok(sql.length > 0, `${fileName} must not be empty`);
    assert.doesNotMatch(sql, /\\(?:un)?restrict\b/);
    assert.doesNotMatch(sql, /\bDROP\s+DATABASE\b/i);
    return { fileName, version: match[1], name: match[2], sql };
  });
}

function isolatedBaselineSql(sql, publicSchema, adminSchema) {
  return sql
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;", "")
    .replace("CREATE SCHEMA admin;", `CREATE SCHEMA "${adminSchema}";`)
    .replaceAll("admin.", `"${adminSchema}".`)
    .replaceAll("public.", `"${publicSchema}".`);
}

async function tableNames(client, schema) {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  );
  return result.rows.map((row) => row.table_name);
}

async function constraintNames(client, schemas) {
  const result = await client.query(
    `SELECT conname FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = ANY($1::text[])`,
    [schemas],
  );
  return new Set(result.rows.map((row) => row.conname));
}

async function triggerNames(client, schema) {
  const result = await client.query(
    `SELECT trigger_name FROM information_schema.triggers
     WHERE trigger_schema = $1`,
    [schema],
  );
  return new Set(result.rows.map((row) => row.trigger_name));
}

async function columnNames(client, schema, table) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

readDotEnv();
const [
  baseline,
  loginSecurityRepair,
  announcementsMigration,
  assetQuotaReleaseMigration,
  communityProfileMigration,
  communityContentMigration,
] = loadMigrations();
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Missing MIGRATION_DATABASE_URL or DATABASE_URL. Migration tests require a disposable PostgreSQL database.",
  );
}

const suffix = randomUUID().replaceAll("-", "");
const publicSchema = `baseline_public_${suffix}`;
const adminSchema = `baseline_admin_${suffix}`;
const client = new pg.Client({ connectionString: databaseUrl });

const expectedPublicTables = [
  "account",
  "account_erasure_jobs",
  "asset_references",
  "asset_uploads",
  "assets",
  "auth_audit_events",
  "auth_devices",
  "generation_telemetry",
  "migration_exports",
  "migration_import_asset_uploads",
  "migration_imports",
  "object_storage_config_publications",
  "password_reset_email_challenges",
  "project_changes",
  "project_edges",
  "project_nodes",
  "project_snapshots",
  "projects",
  "registration_email_challenges",
  "session",
  "site_config_publications",
  "smtp_config_publications",
  "user",
  "verification",
  "workspace_members",
  "workspace_user_state",
  "workspaces",
];

const expectedAdminTables = [
  "account",
  "audit_events",
  "login_captcha_challenges",
  "login_security_settings",
  "object_storage_config_current",
  "object_storage_config_revisions",
  "object_storage_test_attempts",
  "session",
  "site_assets",
  "site_config_current",
  "site_config_revisions",
  "smtp_config_current",
  "smtp_config_revisions",
  "smtp_test_attempts",
  "two_factor",
  "user",
  "verification",
];

try {
  await client.connect();
  await client.query(
    "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public",
  );
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${publicSchema}"`);
  await client.query(
    isolatedBaselineSql(baseline.sql, publicSchema, adminSchema),
  );

  assert.deepEqual(
    await tableNames(client, publicSchema),
    expectedPublicTables,
  );
  assert.deepEqual(await tableNames(client, adminSchema), expectedAdminTables);

  assert.equal(
    (await columnNames(client, publicSchema, "projects")).has("task_count"),
    false,
  );
  assert.equal(
    (await columnNames(client, publicSchema, "workspaces")).has(
      "task_quota_monthly",
    ),
    false,
  );

  const constraints = await constraintNames(client, [
    publicSchema,
    adminSchema,
  ]);
  for (const name of [
    "projects_workspace_id_id_unique",
    "project_nodes_pkey",
    "asset_references_workspace_asset_fk",
    "workspace_members_pkey",
    "smtp_config_current_revision_id_fkey",
    "object_storage_config_current_revision_id_fkey",
  ]) {
    assert.ok(constraints.has(name), `Missing current constraint: ${name}`);
  }

  const adminTriggers = await triggerNames(client, adminSchema);
  for (const name of [
    "admin_audit_events_append_only",
    "admin_site_config_revisions_immutable",
    "admin_smtp_config_revisions_immutable",
    "admin_object_storage_config_revisions_immutable",
  ]) {
    assert.ok(adminTriggers.has(name), `Missing current trigger: ${name}`);
  }

  const loginSecurityTable = `"${adminSchema}".login_security_settings`;
  const initialLoginSecurity = await client.query(
    `SELECT captcha_enabled FROM ${loginSecurityTable} WHERE singleton_id = 1`,
  );
  assert.equal(initialLoginSecurity.rowCount, 1);
  assert.equal(initialLoginSecurity.rows[0].captcha_enabled, false);

  await client.query(
    `DELETE FROM ${loginSecurityTable} WHERE singleton_id = 1`,
  );
  const repairSql = isolatedBaselineSql(
    loginSecurityRepair.sql,
    publicSchema,
    adminSchema,
  );
  await client.query(repairSql);
  await client.query(repairSql);
  const repairedLoginSecurity = await client.query(
    `SELECT captcha_enabled FROM ${loginSecurityTable} WHERE singleton_id = 1`,
  );
  assert.equal(repairedLoginSecurity.rowCount, 1);
  assert.equal(repairedLoginSecurity.rows[0].captcha_enabled, false);

  const announcementsSql = isolatedBaselineSql(
    announcementsMigration.sql,
    publicSchema,
    adminSchema,
  );
  await client.query(announcementsSql);
  const expandedTables = await tableNames(client, publicSchema);
  assert.ok(expandedTables.includes("announcements"));
  assert.ok(expandedTables.includes("announcement_receipts"));

  const assetQuotaReleaseSql = isolatedBaselineSql(
    assetQuotaReleaseMigration.sql,
    publicSchema,
    adminSchema,
  );
  await client.query(assetQuotaReleaseSql);

  const communityProfileSql = isolatedBaselineSql(
    communityProfileMigration.sql,
    publicSchema,
    adminSchema,
  );
  await client.query(communityProfileSql);
  await client.query(communityProfileSql);
  const communityTables = await tableNames(client, publicSchema);
  assert.ok(communityTables.includes("user_public_profiles"));
  const profileColumns = await columnNames(
    client,
    publicSchema,
    "user_public_profiles",
  );
  for (const column of [
    "user_id",
    "public_nickname",
    "profile_status",
    "community_consent_version",
    "community_consent_at",
  ]) {
    assert.ok(
      profileColumns.has(column),
      `Missing community profile ${column}`,
    );
  }

  const communityContentSql = isolatedBaselineSql(
    communityContentMigration.sql,
    publicSchema,
    adminSchema,
  );
  await client.query(communityContentSql);
  await client.query(communityContentSql);
  const contentTables = await tableNames(client, publicSchema);
  for (const table of [
    "community_posts",
    "community_post_tags",
    "community_reports",
  ]) {
    assert.ok(
      contentTables.includes(table),
      `Missing community table ${table}`,
    );
  }

  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("ROLLBACK");
  console.log(`Checked current database baseline ${baseline.fileName}.`);
} finally {
  if (client.readyForQuery) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client
      .query(`DROP SCHEMA IF EXISTS "${publicSchema}" CASCADE`)
      .catch(() => undefined);
    await client
      .query(`DROP SCHEMA IF EXISTS "${adminSchema}" CASCADE`)
      .catch(() => undefined);
  }
  await client.end();
}
