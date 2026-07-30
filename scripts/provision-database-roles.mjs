import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const envPath = join(process.cwd(), ".env");
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function parseEnv(text) {
  const output = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0)
      output.set(
        trimmed.slice(0, index).trim(),
        trimmed
          .slice(index + 1)
          .trim()
          .replace(/^"(.*)"$/, "$1"),
      );
  }
  return output;
}

function updateEnv(text, updates) {
  const remaining = new Map(Object.entries(updates));
  const removed = new Set([
    "WORKER_DATABASE_ROLE",
    "WORKER_DATABASE_PASSWORD",
    "WORKER_DATABASE_URL",
    "PROVIDER_CREDENTIAL_KEYS",
    "PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION",
    "OFFICIAL_PROVIDER_CREDENTIAL_KEYS",
    "OFFICIAL_PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION",
  ]);
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match && removed.has(match[1])) return [];
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (lines.at(-1) !== "") lines.push("");
  lines.push("# P8 Admin isolation (local secrets; never commit)");
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  lines.push("");
  return lines.join("\n");
}

function secret() {
  return randomBytes(36).toString("base64url");
}

function safeRole(value, fallback) {
  const role = value?.trim() || fallback;
  if (!IDENTIFIER.test(role)) throw new Error("Database role name is invalid");
  return role;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function roleUrl(source, role, password) {
  const url = new URL(source);
  url.username = role;
  url.password = password;
  return url.toString();
}

if (!existsSync(envPath)) throw new Error("Missing .env");
const text = readFileSync(envPath, "utf8");
const env = parseEnv(text);
const migrationUrl =
  env.get("MIGRATION_DATABASE_URL") || env.get("DATABASE_URL");
if (!migrationUrl)
  throw new Error("Missing DATABASE_URL or MIGRATION_DATABASE_URL");
const appRole = safeRole(env.get("APP_DATABASE_ROLE"), "ai_canvas_cloud_app");
const adminRole = safeRole(
  env.get("ADMIN_DATABASE_ROLE"),
  "ai_canvas_cloud_admin",
);
const legacyWorkerRole = env.get("WORKER_DATABASE_ROLE")
  ? safeRole(env.get("WORKER_DATABASE_ROLE"), "ai_canvas_cloud_worker")
  : "ai_canvas_cloud_worker";
if (appRole === adminRole)
  throw new Error("Application and Admin database roles must be different");
const appPassword = env.get("APP_DATABASE_PASSWORD") || secret();
const adminPassword = env.get("ADMIN_DATABASE_PASSWORD") || secret();
const adminAuthSecret =
  env.get("ADMIN_BETTER_AUTH_SECRET") || secret() + secret();
const client = new pg.Client({ connectionString: migrationUrl });

async function ensureRole(role, password) {
  const exists = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [role],
  );
  const roleSql = quoteIdentifier(role);
  const passwordSql = quoteLiteral(password);
  if (exists.rowCount === 0) {
    await client.query(
      `CREATE ROLE ${roleSql} LOGIN PASSWORD ${passwordSql} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`,
    );
  } else {
    await client.query(`ALTER ROLE ${roleSql} PASSWORD ${passwordSql}`);
  }
}

try {
  await client.connect();
  const database = await client.query(
    "SELECT current_database() AS name, current_user AS owner",
  );
  const databaseName = database.rows[0]?.name;
  const ownerRole = database.rows[0]?.owner;
  if (!databaseName || !ownerRole || !IDENTIFIER.test(ownerRole))
    throw new Error("Could not resolve migration database owner");
  await ensureRole(appRole, appPassword);
  await ensureRole(adminRole, adminPassword);
  const app = quoteIdentifier(appRole);
  const admin = quoteIdentifier(adminRole);
  const owner = quoteIdentifier(ownerRole);
  const databaseIdentifier = quoteIdentifier(databaseName);
  await client.query("BEGIN");
  await client.query(
    `GRANT CONNECT, CREATE ON DATABASE ${databaseIdentifier} TO ${app}`,
  );
  await client.query(
    `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${admin}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
  );
  await client.query(
    `REVOKE INSERT, UPDATE, DELETE ON public.site_config_publications FROM ${app}`,
  );
  await client.query(
    `GRANT SELECT ON public.site_config_publications TO ${app}`,
  );
  await client.query(
    `REVOKE INSERT, UPDATE, DELETE ON public.smtp_config_publications FROM ${app}`,
  );
  await client.query(
    `GRANT SELECT ON public.smtp_config_publications TO ${app}`,
  );
  await client.query(
    `REVOKE INSERT, UPDATE, DELETE ON public.object_storage_config_publications FROM ${app}`,
  );
  await client.query(
    `GRANT SELECT ON public.object_storage_config_publications TO ${app}`,
  );
  await client.query(
    `REVOKE DELETE ON public.generation_telemetry FROM ${app}`,
  );
  await client.query(`REVOKE ALL ON SCHEMA admin FROM ${app}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM ${app}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM ${app}`);
  await client.query(`GRANT USAGE ON SCHEMA admin TO ${admin}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admin TO ${admin}`,
  );
  await client.query(
    `REVOKE UPDATE, DELETE ON admin.audit_events FROM ${admin}`,
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admin TO ${admin}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA public TO ${admin}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE ON public.site_config_publications TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE ON public.smtp_config_publications TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.object_storage_config_publications TO ${admin}`,
  );
  await client.query(
    `REVOKE ALL ON public."user", public."session", public."account", public."verification", public.auth_devices, public.workspaces, public.workspace_members, public.workspace_user_state, public.projects, public.project_nodes, public.project_edges, public.project_snapshots, public.assets, public.asset_uploads, public.asset_references, public.migration_imports, public.migration_exports, public.migration_import_asset_uploads, public.generation_telemetry, public.account_erasure_jobs, public.registration_email_challenges, public.password_reset_email_challenges FROM ${admin}`,
  );
  await client.query(
    `GRANT SELECT (id, user_no, username, display_username, email, email_verified, status, created_at, updated_at) ON public."user" TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (status, deleted_at, personal_data_purged_at, email, email_verified, username, display_username, name, image, updated_at) ON public."user" TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (id, user_id, expires_at, created_at, updated_at) ON public."session" TO ${admin}`,
  );
  await client.query(`GRANT DELETE ON public."session" TO ${admin}`);
  await client.query(
    `GRANT SELECT (user_id, provider_id) ON public."account" TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (password, updated_at), DELETE ON public."account" TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (id, type, name, owner_user_id, status, plan_key, storage_quota_bytes, created_at, updated_at) ON public.workspaces TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (workspace_id, user_id, role, joined_at) ON public.workspace_members TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (owner_user_id, status, updated_at) ON public.workspaces TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (role), DELETE ON public.workspace_members TO ${admin}`,
  );
  await client.query(`GRANT DELETE ON public.workspace_user_state TO ${admin}`);
  await client.query(
    `GRANT SELECT (id, workspace_id, byte_size, status, deleted_at) ON public.assets TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (id, workspace_id) ON public.projects TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (project_id) ON public.project_nodes TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (project_id) ON public.project_edges TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (project_id) ON public.project_snapshots TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (workspace_id, created_by_user_id) ON public.migration_imports TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (workspace_id, created_by_user_id) ON public.migration_exports TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (workspace_id, expected_byte_size, status, committed_asset_id) ON public.migration_import_asset_uploads TO ${admin}`,
  );
  await client.query(
    `GRANT SELECT (user_id, category, status, failure_category, result_count, duration_ms, started_at, completed_at) ON public.generation_telemetry TO ${admin}`,
  );
  await client.query(`GRANT DELETE ON public.auth_devices TO ${admin}`);
  await client.query(`GRANT DELETE ON public."verification" TO ${admin}`);
  await client.query(
    `GRANT DELETE ON public.registration_email_challenges TO ${admin}`,
  );
  await client.query(
    `GRANT DELETE ON public.password_reset_email_challenges TO ${admin}`,
  );
  await client.query(`GRANT DELETE ON public.generation_telemetry TO ${admin}`);
  await client.query(`GRANT DELETE ON public.asset_references TO ${admin}`);
  await client.query(`GRANT DELETE ON public.project_snapshots TO ${admin}`);
  await client.query(`GRANT DELETE ON public.asset_uploads TO ${admin}`);
  await client.query(
    `GRANT UPDATE (deleted_at, updated_at) ON public.projects TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (deleted_at, updated_at) ON public.project_nodes TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (deleted_at, updated_at) ON public.project_edges TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (status, deleted_at, updated_at) ON public.assets TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (created_by_user_id, updated_at) ON public.migration_imports TO ${admin}`,
  );
  await client.query(
    `GRANT UPDATE (created_by_user_id, updated_at) ON public.migration_exports TO ${admin}`,
  );
  await client.query(`GRANT INSERT ON public.account_erasure_jobs TO ${admin}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${admin}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA admin GRANT USAGE, SELECT ON SEQUENCES TO ${admin}`,
  );
  await client.query(`ALTER ROLE ${app} SET search_path = public`);
  await client.query(`ALTER ROLE ${admin} SET search_path = admin`);
  const legacyWorker = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [legacyWorkerRole],
  );
  if (
    legacyWorker.rowCount > 0 &&
    legacyWorkerRole !== appRole &&
    legacyWorkerRole !== adminRole &&
    legacyWorkerRole !== ownerRole
  ) {
    const worker = quoteIdentifier(legacyWorkerRole);
    await client.query(
      `REVOKE CONNECT ON DATABASE ${databaseIdentifier} FROM ${worker}`,
    );
    await client.query(`DROP OWNED BY ${worker}`);
    await client.query(`DROP ROLE ${worker}`);
  }
  await client.query("COMMIT");

  const updates = {
    MIGRATION_DATABASE_URL: migrationUrl,
    APP_DATABASE_ROLE: appRole,
    APP_DATABASE_PASSWORD: appPassword,
    DATABASE_URL: roleUrl(migrationUrl, appRole, appPassword),
    ADMIN_DATABASE_ROLE: adminRole,
    ADMIN_DATABASE_PASSWORD: adminPassword,
    ADMIN_DATABASE_URL: roleUrl(migrationUrl, adminRole, adminPassword),
    ADMIN_API_HOST: env.get("ADMIN_API_HOST") || "127.0.0.1",
    ADMIN_API_PORT: env.get("ADMIN_API_PORT") || "8788",
    ADMIN_BETTER_AUTH_URL:
      env.get("ADMIN_BETTER_AUTH_URL") || "http://127.0.0.1:8788",
    ADMIN_BETTER_AUTH_SECRET: adminAuthSecret,
    ADMIN_WEB_HOST: env.get("ADMIN_WEB_HOST") || "127.0.0.1",
    ADMIN_WEB_PORT: env.get("ADMIN_WEB_PORT") || "5174",
    ADMIN_WEB_PUBLIC_URL:
      env.get("ADMIN_WEB_PUBLIC_URL") || "http://localhost:5174",
    ADMIN_WEB_ALLOWED_ORIGINS:
      env.get("ADMIN_WEB_ALLOWED_ORIGINS") ||
      "http://localhost:5174,http://127.0.0.1:5174",
  };
  writeFileSync(envPath, updateEnv(text, updates), {
    encoding: "utf8",
    flag: "w",
  });
  console.log(
    `Database role isolation configured for ${appRole} and ${adminRole}; legacy Worker role removed when present; secret values were not printed.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
