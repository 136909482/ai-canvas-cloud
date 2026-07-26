import assert from "node:assert/strict";
import pg from "pg";
import { loadDotEnv } from "@ai-canvas-cloud/server";

loadDotEnv();

for (const key of [
  "WORKER_DATABASE_ROLE",
  "WORKER_DATABASE_PASSWORD",
  "WORKER_DATABASE_URL",
  "PROVIDER_CREDENTIAL_KEYS",
  "PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION",
  "OFFICIAL_PROVIDER_CREDENTIAL_KEYS",
  "OFFICIAL_PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION",
]) {
  assert.equal(
    Boolean(process.env[key]?.trim()),
    false,
    `${key} must be removed`,
  );
}

const connections = {
  app: process.env.DATABASE_URL,
  admin: process.env.ADMIN_DATABASE_URL,
};
const expectedMigrationVersions = Array.from({ length: 31 }, (_, index) =>
  String(index + 1).padStart(4, "0"),
);

if (!connections.app || !connections.admin)
  throw new Error("Missing DATABASE_URL or ADMIN_DATABASE_URL");

const expectedPermissions = {
  app: {
    isSuperuser: false,
    adminSchemaUsage: false,
    adminIdentityRead: false,
    adminLoginSecurityRead: false,
    adminLoginSecurityWrite: false,
    ordinaryIdentityRead: true,
    userOperationsRead: true,
    userStatusWrite: true,
    userSessionDelete: true,
    sensitiveIdentityRead: true,
    projectContentRead: true,
    assetObjectRead: true,
    sitePublicationRead: true,
    sitePublicationWrite: false,
    generationTelemetryRead: true,
    generationTelemetryAttemptRead: true,
  },
  admin: {
    isSuperuser: false,
    adminSchemaUsage: true,
    adminIdentityRead: true,
    adminLoginSecurityRead: true,
    adminLoginSecurityWrite: true,
    ordinaryIdentityRead: false,
    userOperationsRead: true,
    userStatusWrite: true,
    userSessionDelete: true,
    sensitiveIdentityRead: false,
    projectContentRead: false,
    assetObjectRead: false,
    sitePublicationRead: true,
    sitePublicationWrite: true,
    generationTelemetryRead: true,
    generationTelemetryAttemptRead: false,
  },
};

for (const [connection, connectionString] of Object.entries(connections)) {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT current_user AS role,
             rolsuper,
             has_schema_privilege(current_user, 'admin', 'USAGE') AS admin_usage
      FROM pg_roles
      WHERE rolname = current_user
    `);
    let adminIdentityRead = true;
    let ordinaryIdentityRead = true;
    let adminLoginSecurityRead = true;
    let adminLoginSecurityWrite = true;
    let userOperationsRead = true;
    let userStatusWrite = true;
    let userSessionDelete = true;
    let sensitiveIdentityRead = true;
    let projectContentRead = true;
    let assetObjectRead = true;
    let generationTelemetryRead = true;
    let generationTelemetryAttemptRead = true;
    try {
      await client.query('SELECT 1 FROM admin."user" LIMIT 1');
    } catch {
      adminIdentityRead = false;
    }
    try {
      await client.query('SELECT * FROM public."user" LIMIT 1');
    } catch {
      ordinaryIdentityRead = false;
    }
    try {
      await client.query("SELECT 1 FROM admin.login_security_settings LIMIT 1");
    } catch {
      adminLoginSecurityRead = false;
    }
    try {
      await client.query(
        "UPDATE admin.login_security_settings SET updated_at = updated_at WHERE false",
      );
    } catch {
      adminLoginSecurityWrite = false;
    }
    try {
      await client.query(
        `SELECT id, user_no, username, display_username, email, email_verified, status, created_at, updated_at FROM public."user" LIMIT 1`,
      );
      await client.query(
        `SELECT id, user_id, expires_at, created_at, updated_at FROM public."session" LIMIT 1`,
      );
      await client.query(
        `SELECT id, type, name, owner_user_id, status, plan_key, storage_quota_bytes, created_at, updated_at FROM public.workspaces LIMIT 1`,
      );
      await client.query(
        `SELECT workspace_id, user_id, role, joined_at FROM public.workspace_members LIMIT 1`,
      );
      await client.query(
        `SELECT id, workspace_id, byte_size, status, deleted_at FROM public.assets LIMIT 1`,
      );
      await client.query(
        `SELECT workspace_id, expected_byte_size, status, committed_asset_id FROM public.migration_import_asset_uploads LIMIT 1`,
      );
    } catch {
      userOperationsRead = false;
    }
    try {
      await client.query(
        `UPDATE public."user" SET status = status, updated_at = updated_at WHERE false`,
      );
    } catch {
      userStatusWrite = false;
    }
    try {
      await client.query(`DELETE FROM public."session" WHERE false`);
    } catch {
      userSessionDelete = false;
    }
    try {
      await client.query(
        `SELECT a.password, s.token FROM public.account a CROSS JOIN public."session" s LIMIT 1`,
      );
    } catch {
      sensitiveIdentityRead = false;
    }
    try {
      await client.query("SELECT data_json FROM public.project_nodes LIMIT 1");
    } catch {
      projectContentRead = false;
    }
    try {
      await client.query("SELECT object_key FROM public.assets LIMIT 1");
    } catch {
      assetObjectRead = false;
    }
    try {
      await client.query(
        `SELECT user_id, category, status, failure_category, result_count, duration_ms, started_at, completed_at FROM public.generation_telemetry LIMIT 1`,
      );
    } catch {
      generationTelemetryRead = false;
    }
    try {
      await client.query(
        `SELECT client_attempt_id FROM public.generation_telemetry LIMIT 1`,
      );
    } catch {
      generationTelemetryAttemptRead = false;
    }
    const sitePublicationRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.site_config_publications', 'SELECT') AS allowed`,
    );
    const sitePublicationWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.site_config_publications', 'INSERT,UPDATE') AS allowed`,
    );
    const removedRelations = await client.query(
      `
      SELECT namespace.nspname AS schema_name, relation.relname AS relation_name
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE (namespace.nspname = 'public' AND relation.relname = ANY ($1::text[]))
         OR (namespace.nspname = 'admin' AND relation.relname = ANY ($2::text[]))
      ORDER BY namespace.nspname, relation.relname
    `,
      [
        [
          "generation_tasks",
          "task_attempts",
          "task_commands",
          "task_queue_outbox",
          "generation_task_events",
          "usage_ledger",
          "provider_credentials",
          "official_model_publications",
          "workspace_official_credit_periods",
          "official_credit_ledger",
        ],
        [
          "official_providers",
          "official_provider_revisions",
          "official_provider_secrets",
          "official_provider_revision_tests",
          "official_models",
          "official_model_revisions",
        ],
      ],
    );
    assert.deepEqual(
      removedRelations.rows,
      [],
      "server generation relations must be removed",
    );
    const removedFunctions = await client.query(
      `
      SELECT namespace.nspname AS schema_name, function.proname
      FROM pg_catalog.pg_proc function
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
      WHERE proname = ANY ($1::text[])
        AND namespace.nspname = ANY ($2::text[])
      ORDER BY namespace.nspname, function.proname
    `,
      [
        [
          "record_generation_task_event",
          "provider_credentials_fill_legacy_metadata",
          "reserve_official_generation_task",
          "read_official_task_execution",
          "read_official_credit_balance",
          "adjust_official_credits",
        ],
        ["public", "admin"],
      ],
    );
    assert.deepEqual(
      removedFunctions.rows,
      [],
      "server generation functions must be removed",
    );
    const taskReferenceColumn = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asset_references'
        AND column_name = 'task_id'
    `);
    assert.equal(
      taskReferenceColumn.rowCount,
      0,
      "asset_references.task_id must be removed",
    );
    if (connection === "app") {
      const appliedMigrations = await client.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      assert.deepEqual(
        appliedMigrations.rows.map((row) => row.version),
        expectedMigrationVersions,
        "live migration history must match the 29-file release manifest",
      );
    }
    const activePublication = await client.query(`
      SELECT (config_json -> 'features') ? 'officialModeEnabled' AS has_official_mode
      FROM public.site_config_publications
      WHERE singleton_id = 1
    `);
    assert.equal(
      activePublication.rows[0]?.has_official_mode ?? false,
      false,
      "active site publication must not expose retired official mode",
    );
    if (connection === "admin") {
      const activeRevision = await client.query(`
        SELECT (r.config_json -> 'features') ? 'officialModeEnabled' AS has_official_mode
        FROM admin.site_config_current c
        JOIN admin.site_config_revisions r ON r.id = c.revision_id
        WHERE c.singleton_id = 1
      `);
      assert.equal(
        activeRevision.rows[0]?.has_official_mode ?? false,
        false,
        "active Admin site revision must not retain retired official mode",
      );
    }
    const legacyWorkerRole = await client.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'ai_canvas_cloud_worker'`,
    );
    assert.equal(
      legacyWorkerRole.rowCount,
      0,
      "legacy Worker database role must be removed",
    );
    const permissions = {
      isSuperuser: identity.rows[0]?.rolsuper,
      adminSchemaUsage: identity.rows[0]?.admin_usage,
      adminIdentityRead,
      adminLoginSecurityRead,
      adminLoginSecurityWrite,
      ordinaryIdentityRead,
      userOperationsRead,
      userStatusWrite,
      userSessionDelete,
      sensitiveIdentityRead,
      projectContentRead,
      assetObjectRead,
      sitePublicationRead: sitePublicationRead.rows[0]?.allowed,
      sitePublicationWrite: sitePublicationWrite.rows[0]?.allowed,
      generationTelemetryRead,
      generationTelemetryAttemptRead,
    };
    console.log({ connection, role: identity.rows[0]?.role, ...permissions });
    assert.deepEqual(
      permissions,
      expectedPermissions[connection],
      `${connection} database role permissions are not isolated`,
    );
  } finally {
    await client.end();
  }
}
