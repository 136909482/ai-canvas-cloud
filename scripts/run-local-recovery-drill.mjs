import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const composeFile = resolve(root, "infra/deploy/staging/docker-compose.yml");
const temporaryDirectory = resolve(root, ".tmp/local-recovery-drill");
const envFile = resolve(temporaryDirectory, "staging.env");
const suffix = randomBytes(4).toString("hex");
const resourcePrefix = `ai-canvas-cloud-local-recovery-drill-${suffix}`;

function secret(bytes = 24) {
  return randomBytes(bytes).toString("hex");
}

function encodedSecret() {
  return randomBytes(32).toString("base64");
}

function environment(backupId = "local-drill-pending") {
  const postgresPassword = secret();
  const restorePostgresPassword = secret();
  const values = {
    NODE_ENV: "development",
    CONTAINER_REGISTRY: "docker.1ms.run",
    DEPLOYMENT_ENV: "local",
    ASSET_MAINTENANCE_API_URL: "http://api:8787",
    ASSET_MAINTENANCE_TOKEN: secret(32),
    WEB_PUBLIC_URL: "http://127.0.0.1:5173",
    BETTER_AUTH_URL: "http://127.0.0.1:5173",
    WEB_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
    SKIP_OBJECT_CORS: "true",
    BETTER_AUTH_SECRET: secret(32),
    POSTGRES_DB: "ai_canvas_cloud_local_drill",
    POSTGRES_USER: "ai_canvas_cloud_local_drill",
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: `postgres://ai_canvas_cloud_local_drill:${postgresPassword}@postgres:5432/ai_canvas_cloud_local_drill`,
    REDIS_PASSWORD: secret(),
    REDIS_URL: "redis://redis:6379/0",
    S3_ENDPOINT: "http://object-storage:9000",
    S3_PUBLIC_ENDPOINT: "http://object-storage:9000",
    S3_PUBLIC_ORIGIN: "http://object-storage:9000",
    S3_FORCE_PATH_STYLE: "true",
    S3_REGION: "us-east-1",
    S3_BUCKET: "local-recovery-assets",
    S3_ACCESS_KEY_ID: `local${suffix}`,
    S3_SECRET_ACCESS_KEY: secret(),
    OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    OBJECT_STORAGE_CREDENTIAL_KEYS: JSON.stringify({ 1: encodedSecret() }),
    AUTH_EMAIL_TRANSPORT: "managed",
    SMTP_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    SMTP_CREDENTIAL_KEYS: JSON.stringify({ 1: encodedSecret() }),
    DEPLOYMENT_RESOURCE_NAMESPACE: resourcePrefix,
    DEPLOYMENT_CREDENTIAL_NAMESPACE: `${resourcePrefix}-credentials`,
    DATABASE_RESOURCE_ID: `${resourcePrefix}-postgres`,
    REDIS_RESOURCE_ID: `${resourcePrefix}-redis`,
    S3_RESOURCE_ID: `${resourcePrefix}-bucket`,
    MAIL_RESOURCE_ID: `${resourcePrefix}-mail`,
    PERSISTENCE_RESOURCE_ID: `${resourcePrefix}-volumes`,
    DATABASE_CREDENTIAL_ID: `${resourcePrefix}-postgres-credential`,
    REDIS_CREDENTIAL_ID: `${resourcePrefix}-redis-credential`,
    S3_CREDENTIAL_ID: `${resourcePrefix}-object-credential`,
    MAIL_CREDENTIAL_ID: `${resourcePrefix}-mail-credential`,
    STAGING_WEB_PORT: "18080",
    BACKUP_INTERVAL_HOURS: "24",
    BACKUP_RETENTION_DAYS: "1",
    OBJECT_NONCURRENT_RETENTION_DAYS: "1",
    BACKUP_ENCRYPTION_KEY: encodedSecret(),
    BACKUP_S3_ENDPOINT: "http://backup-storage:9000",
    BACKUP_S3_BUCKET: "local-recovery-backups",
    BACKUP_S3_ACCESS_KEY_ID: `backup${suffix}`,
    BACKUP_S3_SECRET_ACCESS_KEY: secret(),
    PUSHGATEWAY_URL: "http://pushgateway:9091",
    RESTORE_BACKUP_ID: backupId,
    RESTORE_POSTGRES_DB: "ai_canvas_cloud_local_drill_restore",
    RESTORE_POSTGRES_USER: "ai_canvas_cloud_local_drill_restore",
    RESTORE_POSTGRES_PASSWORD: restorePostgresPassword,
    RESTORE_DATABASE_URL: `postgres://ai_canvas_cloud_local_drill_restore:${restorePostgresPassword}@restore-postgres:5432/ai_canvas_cloud_local_drill_restore`,
    RESTORE_REDIS_PASSWORD: secret(),
    RESTORE_REDIS_URL: "redis://restore-redis:6379/0",
    RESTORE_S3_ENDPOINT: "http://restore-object-storage:9000",
    RESTORE_S3_BUCKET: "local-recovery-restore-assets",
    RESTORE_S3_ACCESS_KEY_ID: `restore${suffix}`,
    RESTORE_S3_SECRET_ACCESS_KEY: secret(),
    RESTORE_DATABASE_RESOURCE_ID: `${resourcePrefix}-restore-postgres`,
    RESTORE_REDIS_RESOURCE_ID: `${resourcePrefix}-restore-redis`,
    RESTORE_S3_RESOURCE_ID: `${resourcePrefix}-restore-bucket`,
    RESTORE_AUDIT_MIN_WORKSPACES: "2",
    RESTORE_RESET_CONFIRMED: "true",
    STAGING_COMPOSE_PROJECT: resourcePrefix,
    STAGING_RESOURCE_PREFIX: resourcePrefix,
    STAGING_RUNTIME_ENV_FILE: envFile.replaceAll("\\", "/"),
    RECOVERY_ENV_FILE: envFile.replaceAll("\\", "/"),
  };
  return values;
}

let currentEnvironment = environment();

async function writeEnvironment() {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const body = Object.entries(currentEnvironment)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await fs.writeFile(envFile, `${body}\n`, { mode: 0o600 });
}

function run(command, args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...currentEnvironment },
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      windowsHide: true,
    });
    if (capture) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || allowFailure) resolvePromise(output);
      else
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

const compose = (...args) =>
  run("docker", ["compose", "--env-file", envFile, "-f", composeFile, ...args]);

try {
  await writeEnvironment();
  await compose(
    "up",
    "-d",
    "--wait",
    "postgres",
    "object-storage",
    "backup-storage",
    "pushgateway",
  );
  await compose("run", "--rm", "create-bucket");
  await compose("run", "--rm", "create-backup-bucket");
  await compose(
    "run",
    "--rm",
    "--no-deps",
    "migrate",
    "node",
    "scripts/apply-migrations.mjs",
  );
  await compose(
    "run",
    "--rm",
    "--no-deps",
    "backup-scheduler",
    "node",
    "scripts/seed-local-recovery-drill.mjs",
  );
  const backupOutput = await run(
    "docker",
    [
      "compose",
      "--env-file",
      envFile,
      "-f",
      composeFile,
      "run",
      "--rm",
      "--no-deps",
      "backup-scheduler",
      "node",
      "scripts/create-staging-backup.mjs",
    ],
    { capture: true },
  );
  const events = backupOutput
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const backupId = events.findLast(
    (event) => event.event === "staging_backup_completed",
  )?.backupId;
  if (!backupId) throw new Error("Backup command did not return a backup ID");

  currentEnvironment = { ...currentEnvironment, RESTORE_BACKUP_ID: backupId };
  await writeEnvironment();
  await run("node", ["scripts/run-staging-restore-drill.mjs"], {
    capture: false,
  });
  console.log(
    JSON.stringify({ event: "local_recovery_drill_completed", backupId }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "local_recovery_drill_failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
} finally {
  await run(
    "docker",
    [
      "compose",
      "--env-file",
      envFile,
      "-f",
      composeFile,
      "--profile",
      "restore",
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { allowFailure: true },
  ).catch(() => undefined);
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
