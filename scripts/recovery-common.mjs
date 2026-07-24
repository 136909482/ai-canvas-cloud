import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const BACKUP_MAGIC = Buffer.from("AICB1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function requiredEnv(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

export function parseEncryptionKey(value) {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be a canonical base64 32-byte key",
    );
  }
  return key;
}

export function assertRestoreIsolation(env) {
  const pairs = [
    ["DATABASE_RESOURCE_ID", "RESTORE_DATABASE_RESOURCE_ID"],
    ["REDIS_RESOURCE_ID", "RESTORE_REDIS_RESOURCE_ID"],
    ["S3_RESOURCE_ID", "RESTORE_S3_RESOURCE_ID"],
    ["S3_BUCKET", "RESTORE_S3_BUCKET"],
  ];
  for (const [sourceKey, restoreKey] of pairs) {
    const source = requiredEnv(env, sourceKey);
    const restore = requiredEnv(env, restoreKey);
    if (source === restore || !/restore/i.test(restore)) {
      throw new Error(
        `${restoreKey} must be a distinct restore-only identifier`,
      );
    }
  }
  const target = new URL(requiredEnv(env, "RESTORE_DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(target.protocol))
    throw new Error("RESTORE_DATABASE_URL must use PostgreSQL");
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(target.hostname))
    throw new Error("RESTORE_DATABASE_URL must not target localhost");
  if (!/restore/i.test(target.hostname))
    throw new Error("RESTORE_DATABASE_URL host must be restore-only");
  if (env.RESTORE_RESET_CONFIRMED !== "true")
    throw new Error("RESTORE_RESET_CONFIRMED must be true");
  return true;
}

export function postgresProcessEnv(urlValue, baseEnv = process.env) {
  const url = new URL(urlValue);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Database URL must use PostgreSQL");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("Database URL must include a database name");
  return {
    ...baseEnv,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    ...(url.searchParams.get("sslmode")
      ? { PGSSLMODE: url.searchParams.get("sslmode") }
      : {}),
  };
}

export async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "ignore",
      windowsHide: true,
    });
    child.once("error", () =>
      reject(new Error(`${basename(command)} could not start`)),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              `${basename(command)} failed with exit code ${code ?? "unknown"}`,
            ),
          ),
    );
  });
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function encryptBackup(sourcePath, targetPath, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  async function* encrypted() {
    yield Buffer.concat([BACKUP_MAGIC, iv]);
    for await (const chunk of createReadStream(sourcePath).pipe(cipher))
      yield chunk;
    yield cipher.getAuthTag();
  }
  await pipeline(
    Readable.from(encrypted()),
    createWriteStream(targetPath, { mode: 0o600 }),
  );
}

export async function decryptBackup(sourcePath, targetPath, key) {
  const stat = await fs.stat(sourcePath);
  if (stat.size <= BACKUP_MAGIC.length + IV_BYTES + TAG_BYTES)
    throw new Error("Encrypted backup is truncated");
  const handle = await fs.open(sourcePath, "r");
  try {
    const header = Buffer.alloc(BACKUP_MAGIC.length + IV_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, stat.size - TAG_BYTES);
    if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC))
      throw new Error("Encrypted backup format is invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(BACKUP_MAGIC.length),
    );
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, {
        start: header.length,
        end: stat.size - TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(targetPath, { mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}

export async function pruneBackupFiles(
  directory,
  retentionDays,
  now = Date.now(),
) {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 365
  ) {
    throw new Error("BACKUP_RETENTION_DAYS must be between 1 and 365");
  }
  const root = resolve(directory);
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !/^[0-9TZ-]+\.(?:dump\.enc|manifest\.json|source-guard\.json)$/.test(
        entry.name,
      )
    )
      continue;
    const path = resolve(join(root, entry.name));
    if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`))
      throw new Error("Backup retention path escaped its root");
    if ((await fs.stat(path)).mtimeMs < cutoff) {
      await fs.unlink(path);
      deleted += 1;
    }
  }
  return deleted;
}

export async function createRecoveryFingerprint(client) {
  const tables = [
    "workspaces",
    "workspace_members",
    "projects",
    "project_nodes",
    "project_edges",
    "project_changes",
    "project_snapshots",
    "assets",
    "asset_references",
    "migration_imports",
    "migration_exports",
  ];
  const counts = {};
  for (const table of tables) {
    const result = await client.query(
      `SELECT count(*)::integer AS count FROM ${table}`,
    );
    counts[table] = result.rows[0]?.count ?? 0;
  }
  const digestResult = await client.query(`
    SELECT encode(digest(string_agg(item, '|' ORDER BY item), 'sha256'), 'hex') AS digest
    FROM (
      SELECT 'p:' || id::text || ':' || workspace_id::text || ':' || version::text || ':' || last_sequence::text AS item FROM projects
      UNION ALL SELECT 'a:' || id::text || ':' || workspace_id::text || ':' || status || ':' || COALESCE(sha256, '') FROM assets
      UNION ALL SELECT 'm:' || id::text || ':' || workspace_id::text || ':' || status FROM migration_imports
      UNION ALL SELECT 'e:' || id::text || ':' || workspace_id::text || ':' || status FROM migration_exports
    ) fingerprint_items
  `);
  return {
    counts,
    digest:
      digestResult.rows[0]?.digest ??
      createHash("sha256").update("").digest("hex"),
  };
}

export async function pushBackupMetrics(url, input) {
  if (!url) return;
  const body = input.success
    ? [
        `ai_canvas_backup_last_success_timestamp_seconds ${Math.floor(input.timestamp / 1000)}`,
        `ai_canvas_backup_duration_seconds ${input.durationSeconds}`,
        `ai_canvas_backup_encrypted_bytes ${input.encryptedBytes ?? 0}`,
        "",
      ].join("\n")
    : `ai_canvas_backup_last_failure_timestamp_seconds ${Math.floor(input.timestamp / 1000)}\n`;
  const response = await fetch(
    new URL(
      `/metrics/job/staging_backup/outcome/${input.success ? "success" : "failure"}`,
      url,
    ),
    {
      method: "PUT",
      headers: { "content-type": "text/plain; version=0.0.4" },
      body,
    },
  );
  if (!response.ok) throw new Error("Backup metrics push failed");
}
