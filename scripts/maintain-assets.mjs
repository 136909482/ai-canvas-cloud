import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresPool } from "../server/dist/db/postgres.js";
import { loadDotEnv } from "../server/dist/env/loadDotEnv.js";
import {
  ASSET_GC_DEFAULT_GRACE_HOURS,
  ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE,
  ASSET_MAINTENANCE_MAX_BATCH_SIZE,
  ASSET_GC_MAX_GRACE_HOURS,
  createPostgresAssetMaintenanceService,
  createS3ObjectStorage,
} from "../server/dist/modules/assets/index.js";

function usage() {
  return [
    "Usage: npm run db:maintain:assets -- [--apply] [--batch-size=<1-500>] [--grace-hours=<1-8760>]",
    "",
    "Diagnoses missing database objects and managed-prefix orphan objects in read-only mode by default.",
    "Pass --apply to garbage-collect only unreferenced objects older than the grace period.",
  ].join("\n");
}

export function parseAssetMaintenanceArgs(args) {
  let apply = false;
  let batchSize = ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE;
  let graceHours = ASSET_GC_DEFAULT_GRACE_HOURS;

  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, apply, batchSize, graceHours };
    }
    if (arg.startsWith("--batch-size=")) {
      batchSize = Number(arg.slice("--batch-size=".length));
      continue;
    }
    if (arg.startsWith("--grace-hours=")) {
      graceHours = Number(arg.slice("--grace-hours=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > ASSET_MAINTENANCE_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `--batch-size must be between 1 and ${ASSET_MAINTENANCE_MAX_BATCH_SIZE}`,
    );
  }
  if (
    !Number.isInteger(graceHours) ||
    graceHours < 1 ||
    graceHours > ASSET_GC_MAX_GRACE_HOURS
  ) {
    throw new Error(
      `--grace-hours must be between 1 and ${ASSET_GC_MAX_GRACE_HOURS}`,
    );
  }
  return { help: false, apply, batchSize, graceHours };
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Asset maintenance requires PostgreSQL and S3-compatible storage.`,
    );
  }
  return value;
}

async function main() {
  const options = parseAssetMaintenanceArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  loadDotEnv();
  const pool = createPostgresPool({
    connectionString: requireEnvironment("DATABASE_URL"),
  });
  const storage = createS3ObjectStorage({
    endpoint: requireEnvironment("S3_ENDPOINT"),
    bucket: requireEnvironment("S3_BUCKET"),
    region: requireEnvironment("S3_REGION"),
    accessKeyId: requireEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnvironment("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: true,
  });
  const service = createPostgresAssetMaintenanceService(pool, storage);
  const runId = randomUUID();
  const mode = options.apply ? "apply" : "preflight";
  const cutoff = new Date(Date.now() - options.graceHours * 60 * 60 * 1000);
  const counts = {};
  let scannedAssets = 0;
  let scannedObjects = 0;

  try {
    let cursor = null;
    do {
      const batch = await service.maintainAssetBatch({
        apply: options.apply,
        batchSize: options.batchSize,
        cutoff,
        cursor,
      });
      for (const item of batch.items) {
        scannedAssets += 1;
        counts[item.action] = (counts[item.action] ?? 0) + 1;
        console.log(
          JSON.stringify({
            event: "asset_maintenance_database_item",
            runId,
            mode,
            ...item,
          }),
        );
      }
      cursor = batch.nextCursor;
    } while (cursor);

    let startAfter = null;
    do {
      const page = await service.maintainOrphanObjectPage({
        apply: options.apply,
        batchSize: options.batchSize,
        cutoff,
        startAfter,
      });
      for (const item of page.items) {
        scannedObjects += 1;
        counts[item.action] = (counts[item.action] ?? 0) + 1;
        console.log(
          JSON.stringify({
            event: "asset_maintenance_object_item",
            runId,
            mode,
            ...item,
          }),
        );
      }
      if (page.nextStartAfter && page.nextStartAfter === startAfter) {
        throw new Error("Object storage returned a repeated object cursor");
      }
      startAfter = page.nextStartAfter;
    } while (startAfter);

    console.log(
      JSON.stringify({
        event: "asset_maintenance_summary",
        runId,
        mode,
        batchSize: options.batchSize,
        graceHours: options.graceHours,
        cutoff: cutoff.toISOString(),
        scannedAssets,
        scannedObjects,
        counts,
      }),
    );
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
