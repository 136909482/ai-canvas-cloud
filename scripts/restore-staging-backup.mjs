import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { auditRestoredState } from "./audit-restored-state.mjs";
import {
  assertRestoreIsolation,
  decryptBackup,
  parseEncryptionKey,
  postgresProcessEnv,
  requiredEnv,
  runCommand,
  sha256File,
} from "./recovery-common.mjs";

function mcHost(endpoint, accessKey, secretKey) {
  const url = new URL(endpoint);
  url.username = accessKey;
  url.password = secretKey;
  return url.toString();
}

async function selectManifest(directory, requestedId) {
  const files = (await fs.readdir(directory))
    .filter((name) => /^[0-9TZ-]+\.manifest\.json$/.test(name))
    .sort();
  const fileName = requestedId ? `${requestedId}.manifest.json` : files.at(-1);
  if (!fileName || !files.includes(fileName))
    throw new Error("Requested backup manifest was not found");
  const root = resolve(directory);
  const path = resolve(join(root, fileName));
  if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`))
    throw new Error("Backup manifest escaped its root");
  const manifest = JSON.parse(await fs.readFile(path, "utf8"));
  if (
    manifest.formatVersion !== 1 ||
    manifest.backupId !== fileName.slice(0, -".manifest.json".length)
  ) {
    throw new Error("Backup manifest format is invalid");
  }
  if (
    manifest.database?.encryptedFile !== `${manifest.backupId}.dump.enc` ||
    !/^[0-9a-f]{64}$/.test(manifest.database?.encryptedSha256 ?? "") ||
    manifest.objects?.prefix !== `snapshots/${manifest.backupId}/objects`
  ) {
    throw new Error("Backup manifest paths or checksum are invalid");
  }
  return manifest;
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value))
    throw new Error("Restore database identifier is invalid");
  return `"${value}"`;
}

async function resetRestoreDatabase(databaseUrl) {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  const owner = decodeURIComponent(target.username);
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    );
    await admin.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(owner)}`,
    );
  } finally {
    await admin.end();
  }
}

export async function restoreStagingBackup(env = process.env) {
  const startedAt = Date.now();
  assertRestoreIsolation(env);
  const directory = requiredEnv(env, "BACKUP_DIRECTORY");
  const manifest = await selectManifest(
    directory,
    env.RESTORE_BACKUP_ID?.trim(),
  );
  if (manifest.objects.bucket !== requiredEnv(env, "BACKUP_S3_BUCKET"))
    throw new Error(
      "Backup manifest bucket does not match the isolated backup resource",
    );
  const encryptedPath = join(directory, manifest.database.encryptedFile);
  if ((await sha256File(encryptedPath)) !== manifest.database.encryptedSha256)
    throw new Error("Encrypted backup checksum mismatch");
  const decryptedPath = join(directory, `${manifest.backupId}.restore.tmp`);
  const databaseUrl = requiredEnv(env, "RESTORE_DATABASE_URL");
  await resetRestoreDatabase(databaseUrl);

  try {
    await decryptBackup(
      encryptedPath,
      decryptedPath,
      parseEncryptionKey(requiredEnv(env, "BACKUP_ENCRYPTION_KEY")),
    );
    await runCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
        "--dbname",
        requiredEnv(env, "RESTORE_POSTGRES_DB"),
        decryptedPath,
      ],
      {
        env: postgresProcessEnv(databaseUrl, env),
      },
    );
    await runCommand("node", ["scripts/apply-migrations.mjs"], {
      cwd: process.cwd(),
      env: {
        ...env,
        NODE_ENV: "development",
        DEPLOYMENT_ENV: "restore",
        DATABASE_URL: databaseUrl,
      },
    });

    await runCommand(
      "mc",
      [
        "mirror",
        "--overwrite",
        "--preserve",
        `backup/${requiredEnv(env, "BACKUP_S3_BUCKET")}/${manifest.objects.prefix}`,
        `restore/${requiredEnv(env, "RESTORE_S3_BUCKET")}`,
      ],
      {
        env: {
          ...env,
          MC_HOST_backup: mcHost(
            requiredEnv(env, "BACKUP_S3_ENDPOINT"),
            requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID"),
            requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY"),
          ),
          MC_HOST_restore: mcHost(
            requiredEnv(env, "RESTORE_S3_ENDPOINT"),
            requiredEnv(env, "RESTORE_S3_ACCESS_KEY_ID"),
            requiredEnv(env, "RESTORE_S3_SECRET_ACCESS_KEY"),
          ),
        },
      },
    );

    const audit = await auditRestoredState(env, manifest.database.fingerprint);
    console.log(
      JSON.stringify({
        event: "staging_restore_drill_completed",
        backupId: manifest.backupId,
        checkedObjects: audit.checkedObjects,
        rtoSeconds: (Date.now() - startedAt) / 1000,
      }),
    );
    return audit;
  } finally {
    await fs.unlink(decryptedPath).catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  restoreStagingBackup().catch((error) => {
    console.error(
      JSON.stringify({
        event: "staging_restore_drill_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    process.exitCode = 1;
  });
}
