import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  createRecoveryFingerprint,
  encryptBackup,
  parseEncryptionKey,
  postgresProcessEnv,
  pruneBackupFiles,
  pushBackupMetrics,
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

export async function createStagingBackup(env = process.env) {
  const startedAt = Date.now();
  const backupId = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const backupDirectory = requiredEnv(env, "BACKUP_DIRECTORY");
  const retentionDays = Number(requiredEnv(env, "BACKUP_RETENTION_DAYS"));
  const encryptedPath = join(backupDirectory, `${backupId}.dump.enc`);
  const manifestPath = join(backupDirectory, `${backupId}.manifest.json`);
  const temporaryPath = join(backupDirectory, `${backupId}.dump.tmp`);
  const key = parseEncryptionKey(requiredEnv(env, "BACKUP_ENCRYPTION_KEY"));
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });

  async function fail(error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    await fs.unlink(encryptedPath).catch(() => undefined);
    await fs.unlink(manifestPath).catch(() => undefined);
    await pushBackupMetrics(env.PUSHGATEWAY_URL, {
      success: false,
      timestamp: Date.now(),
      durationSeconds: (Date.now() - startedAt) / 1000,
    }).catch(() => undefined);
    throw error;
  }

  const databaseUrl = requiredEnv(env, "DATABASE_URL");
  const client = new pg.Client({ connectionString: databaseUrl });
  let fingerprint;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await client.query(
      "SELECT pg_export_snapshot() AS snapshot",
    );
    fingerprint = await createRecoveryFingerprint(client);
    await runCommand(
      "pg_dump",
      [
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-acl",
        "--snapshot",
        snapshot.rows[0].snapshot,
        "--file",
        temporaryPath,
      ],
      { env: postgresProcessEnv(databaseUrl, env) },
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(error);
  } finally {
    await client.end();
  }

  try {
    await encryptBackup(temporaryPath, encryptedPath, key);
    await fs.unlink(temporaryPath).catch(() => undefined);

    const sourceBucket = requiredEnv(env, "S3_BUCKET");
    const backupBucket = requiredEnv(env, "BACKUP_S3_BUCKET");
    const objectPrefix = `snapshots/${backupId}/objects`;
    await runCommand(
      "mc",
      [
        "mirror",
        "--overwrite",
        "--preserve",
        `primary/${sourceBucket}`,
        `backup/${backupBucket}/${objectPrefix}`,
      ],
      {
        env: {
          ...env,
          MC_HOST_primary: mcHost(
            requiredEnv(env, "S3_ENDPOINT"),
            requiredEnv(env, "S3_ACCESS_KEY_ID"),
            requiredEnv(env, "S3_SECRET_ACCESS_KEY"),
          ),
          MC_HOST_backup: mcHost(
            requiredEnv(env, "BACKUP_S3_ENDPOINT"),
            requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID"),
            requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY"),
          ),
        },
      },
    );

    const stat = await fs.stat(encryptedPath);
    const manifest = {
      formatVersion: 1,
      backupId,
      createdAt: new Date(startedAt).toISOString(),
      encryption: "aes-256-gcm",
      database: {
        encryptedFile: `${backupId}.dump.enc`,
        encryptedBytes: stat.size,
        encryptedSha256: await sha256File(encryptedPath),
        fingerprint,
      },
      objects: { bucket: backupBucket, prefix: objectPrefix },
      retentionDays,
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await runCommand(
      "mc",
      [
        "cp",
        manifestPath,
        `backup/${backupBucket}/manifests/${backupId}.manifest.json`,
      ],
      {
        env: {
          ...env,
          MC_HOST_backup: mcHost(
            requiredEnv(env, "BACKUP_S3_ENDPOINT"),
            requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID"),
            requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY"),
          ),
        },
      },
    );
    await pruneBackupFiles(backupDirectory, retentionDays);
    await pushBackupMetrics(env.PUSHGATEWAY_URL, {
      success: true,
      timestamp: Date.now(),
      durationSeconds: (Date.now() - startedAt) / 1000,
      encryptedBytes: stat.size,
    }).catch(() => undefined);
    console.log(
      JSON.stringify({
        event: "staging_backup_completed",
        backupId,
        encryptedBytes: stat.size,
      }),
    );
    return manifest;
  } catch (error) {
    return fail(error);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createStagingBackup().catch((error) => {
    console.error(
      JSON.stringify({
        event: "staging_backup_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    process.exitCode = 1;
  });
}
