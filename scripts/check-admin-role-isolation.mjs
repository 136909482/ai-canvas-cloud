import assert from "node:assert/strict";
import pg from "pg";
import { loadDotEnv } from "@ai-canvas-cloud/server";
import { buildSupportedMigrationHistories } from "./check-schema-release.mjs";

loadDotEnv();

const connections = {
  app: process.env.DATABASE_URL,
  admin: process.env.ADMIN_DATABASE_URL,
};
const {
  currentBaseline: currentBaselineMigrationVersions,
  legacyUpgrade: legacyMigrationVersions,
} = buildSupportedMigrationHistories();

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
    credentialSelectorRead: true,
    credentialPasswordWrite: true,
    sensitiveIdentityRead: true,
    projectContentRead: true,
    assetObjectRead: true,
    sitePublicationRead: true,
    sitePublicationWrite: false,
    smtpPublicationRead: true,
    smtpPublicationWrite: false,
    objectStoragePublicationRead: true,
    objectStoragePublicationWrite: false,
    registrationEmailChallengeRead: true,
    registrationEmailChallengeWrite: true,
    passwordResetEmailChallengeRead: true,
    passwordResetEmailChallengeWrite: true,
    generationTelemetryRead: true,
    generationTelemetryAttemptRead: true,
    accountErasureWrite: true,
    communityProfileRead: true,
    communityProfileWrite: true,
    communityProfileDelete: true,
    communityContentRead: true,
    communityContentWrite: true,
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
    credentialSelectorRead: true,
    credentialPasswordWrite: true,
    sensitiveIdentityRead: false,
    projectContentRead: false,
    assetObjectRead: false,
    sitePublicationRead: true,
    sitePublicationWrite: true,
    smtpPublicationRead: true,
    smtpPublicationWrite: true,
    objectStoragePublicationRead: true,
    objectStoragePublicationWrite: true,
    registrationEmailChallengeRead: false,
    registrationEmailChallengeWrite: true,
    passwordResetEmailChallengeRead: false,
    passwordResetEmailChallengeWrite: true,
    generationTelemetryRead: true,
    generationTelemetryAttemptRead: false,
    accountErasureWrite: true,
    communityProfileRead: false,
    communityProfileWrite: false,
    communityProfileDelete: true,
    communityContentRead: true,
    communityContentWrite: true,
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
    let credentialSelectorRead = true;
    let credentialPasswordWrite = true;
    let sensitiveIdentityRead = true;
    let projectContentRead = true;
    let assetObjectRead = true;
    let generationTelemetryRead = true;
    let generationTelemetryAttemptRead = true;
    let accountErasureWrite = true;
    const communityProfileRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.user_public_profiles', 'SELECT') AS allowed`,
    );
    const communityProfileWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.user_public_profiles', 'INSERT,UPDATE') AS allowed`,
    );
    const communityProfileDelete = await client.query(
      `SELECT has_table_privilege(current_user, 'public.user_public_profiles', 'DELETE') AS allowed`,
    );
    const communityContentRead = await client.query(
      `SELECT has_column_privilege(current_user, 'public.community_posts', 'id', 'SELECT')
           AND has_column_privilege(current_user, 'public.user_public_profiles', 'public_nickname', 'SELECT')
           AND has_column_privilege(current_user, 'public.user_public_profiles', 'profile_status', 'SELECT')
           AND has_table_privilege(current_user, 'public.community_post_tags', 'SELECT')
           AND has_column_privilege(current_user, 'public.community_reports', 'id', 'SELECT') AS allowed`,
    );
    const communityContentWrite = await client.query(
      `SELECT has_column_privilege(current_user, 'public.community_posts', 'status', 'UPDATE')
           AND has_column_privilege(current_user, 'public.community_reports', 'status', 'UPDATE')
           AND has_table_privilege(current_user, 'public.community_reports', 'DELETE') AS allowed`,
    );
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
        `SELECT user_id, provider_id FROM public."account" LIMIT 1`,
      );
    } catch {
      credentialSelectorRead = false;
    }
    try {
      await client.query(
        `UPDATE public."account" SET password = 'permission-check', updated_at = now() WHERE false`,
      );
    } catch {
      credentialPasswordWrite = false;
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
    try {
      const erasurePermissions = await client.query(`
        SELECT
          has_column_privilege(current_user, 'public."user"', 'email', 'UPDATE') AS user_tombstone,
          has_table_privilege(current_user, 'public."account"', 'DELETE') AS account_delete,
          has_table_privilege(current_user, 'public.workspace_members', 'DELETE') AS membership_delete,
          has_column_privilege(current_user, 'public.projects', 'deleted_at', 'UPDATE') AS project_soft_delete,
          has_column_privilege(current_user, 'public.assets', 'deleted_at', 'UPDATE') AS asset_soft_delete,
          has_table_privilege(current_user, 'public.account_erasure_jobs', 'INSERT') AS erasure_job_insert
      `);
      accountErasureWrite = Object.values(
        erasurePermissions.rows[0] ?? {},
      ).every(Boolean);
      await client.query(
        `UPDATE public.project_edges pe
         SET deleted_at = COALESCE(pe.deleted_at, GREATEST(now(), pe.created_at)),
             updated_at = now()
         FROM public.projects p
         WHERE pe.project_id = p.id AND false`,
      );
      await client.query(
        `UPDATE public.project_nodes pn
         SET deleted_at = COALESCE(pn.deleted_at, GREATEST(now(), pn.created_at)),
             updated_at = now()
         FROM public.projects p
         WHERE pn.project_id = p.id AND false`,
      );
      await client.query(
        `UPDATE public.projects
         SET deleted_at = COALESCE(deleted_at, GREATEST(now(), created_at)),
             updated_at = now()
         WHERE workspace_id IS NULL AND false`,
      );
      await client.query(
        `UPDATE public.assets
         SET status = 'deleted',
             deleted_at = COALESCE(deleted_at, GREATEST(now(), created_at)),
             updated_at = now()
         WHERE workspace_id IS NULL AND false`,
      );
      await client.query(
        `UPDATE public."user"
         SET deleted_at = COALESCE(deleted_at, now())
         WHERE id = '' AND false`,
      );
      await client.query(
        `UPDATE public.migration_imports mi SET created_by_user_id = w.owner_user_id
         FROM public.workspaces w
         WHERE mi.workspace_id = w.id AND false`,
      );
      await client.query(
        `UPDATE public.migration_exports me SET created_by_user_id = w.owner_user_id
         FROM public.workspaces w
         WHERE me.workspace_id = w.id AND false`,
      );
      await client.query(
        `DELETE FROM public.workspace_user_state wus
         USING public.workspaces w
         WHERE wus.workspace_id = w.id
           AND wus.user_id = ''
           AND w.type = 'team'
           AND false`,
      );
      await client.query(
        `DELETE FROM public.asset_references
         WHERE workspace_id IS NULL AND false`,
      );
      await client.query(
        `DELETE FROM public.asset_uploads
         WHERE workspace_id IS NULL AND false`,
      );
      await client.query(
        `DELETE FROM public.auth_devices WHERE user_id = '' AND false`,
      );
      await client.query(
        `DELETE FROM public."verification" WHERE identifier = '' AND false`,
      );
      await client.query(
        `DELETE FROM public.registration_email_challenges
         WHERE email_hash = '' AND false`,
      );
      await client.query(
        `DELETE FROM public.password_reset_email_challenges
         WHERE email_hash = '' AND false`,
      );
    } catch {
      accountErasureWrite = false;
    }
    const sitePublicationRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.site_config_publications', 'SELECT') AS allowed`,
    );
    const sitePublicationWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.site_config_publications', 'INSERT,UPDATE') AS allowed`,
    );
    const smtpPublicationRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.smtp_config_publications', 'SELECT') AS allowed`,
    );
    const smtpPublicationWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.smtp_config_publications', 'INSERT,UPDATE') AS allowed`,
    );
    const objectStoragePublicationRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.object_storage_config_publications', 'SELECT') AS allowed`,
    );
    const objectStoragePublicationWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.object_storage_config_publications', 'INSERT,UPDATE,DELETE') AS allowed`,
    );
    const registrationEmailChallengeRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.registration_email_challenges', 'SELECT') AS allowed`,
    );
    const registrationEmailChallengeWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.registration_email_challenges', 'INSERT,UPDATE,DELETE') AS allowed`,
    );
    const passwordResetEmailChallengeRead = await client.query(
      `SELECT has_table_privilege(current_user, 'public.password_reset_email_challenges', 'SELECT') AS allowed`,
    );
    const passwordResetEmailChallengeWrite = await client.query(
      `SELECT has_table_privilege(current_user, 'public.password_reset_email_challenges', 'INSERT,UPDATE,DELETE') AS allowed`,
    );
    if (connection === "app") {
      const appliedMigrations = await client.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      const appliedMigrationVersions = appliedMigrations.rows.map(
        (row) => row.version,
      );
      assert.ok(
        [currentBaselineMigrationVersions, legacyMigrationVersions].some(
          (expected) =>
            JSON.stringify(appliedMigrationVersions) ===
            JSON.stringify(expected),
        ),
        "live migration history must match the current baseline or legacy upgrade path",
      );
    }
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
      credentialSelectorRead,
      credentialPasswordWrite,
      sensitiveIdentityRead,
      projectContentRead,
      assetObjectRead,
      sitePublicationRead: sitePublicationRead.rows[0]?.allowed,
      sitePublicationWrite: sitePublicationWrite.rows[0]?.allowed,
      smtpPublicationRead: smtpPublicationRead.rows[0]?.allowed,
      smtpPublicationWrite: smtpPublicationWrite.rows[0]?.allowed,
      objectStoragePublicationRead:
        objectStoragePublicationRead.rows[0]?.allowed,
      objectStoragePublicationWrite:
        objectStoragePublicationWrite.rows[0]?.allowed,
      registrationEmailChallengeRead:
        registrationEmailChallengeRead.rows[0]?.allowed,
      registrationEmailChallengeWrite:
        registrationEmailChallengeWrite.rows[0]?.allowed,
      passwordResetEmailChallengeRead:
        passwordResetEmailChallengeRead.rows[0]?.allowed,
      passwordResetEmailChallengeWrite:
        passwordResetEmailChallengeWrite.rows[0]?.allowed,
      generationTelemetryRead,
      generationTelemetryAttemptRead,
      accountErasureWrite,
      communityProfileRead: communityProfileRead.rows[0]?.allowed,
      communityProfileWrite: communityProfileWrite.rows[0]?.allowed,
      communityProfileDelete: communityProfileDelete.rows[0]?.allowed,
      communityContentRead: communityContentRead.rows[0]?.allowed,
      communityContentWrite: communityContentWrite.rows[0]?.allowed,
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
