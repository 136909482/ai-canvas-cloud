import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresPool } from "../server/dist/db/postgres.js";
import { loadDotEnv } from "../server/dist/env/loadDotEnv.js";
import {
  CHECKPOINT_ASSET_REPAIR_DEFAULT_BATCH_SIZE,
  CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE,
  createPostgresCheckpointAssetManifestRepairService,
} from "../server/dist/modules/project-snapshots/postgresCheckpointAssetManifestRepair.js";

function usage() {
  return [
    "Usage: npm run db:repair:checkpoint-assets -- [--apply] [--batch-size=<1-500>]",
    "",
    "Runs a read-only preflight by default. Pass --apply to commit bounded per-checkpoint repairs.",
  ].join("\n");
}

export function parseCheckpointAssetRepairArgs(args) {
  let apply = false;
  let batchSize = CHECKPOINT_ASSET_REPAIR_DEFAULT_BATCH_SIZE;

  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, apply, batchSize };
    }
    if (arg.startsWith("--batch-size=")) {
      batchSize = Number(arg.slice("--batch-size=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `--batch-size must be between 1 and ${CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE}`,
    );
  }
  return { help: false, apply, batchSize };
}

async function main() {
  const options = parseCheckpointAssetRepairArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  loadDotEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Missing DATABASE_URL. The checkpoint asset repair requires PostgreSQL.",
    );
  }

  const runId = randomUUID();
  const mode = options.apply ? "apply" : "preflight";
  const pool = createPostgresPool({
    connectionString: process.env.DATABASE_URL,
  });
  const service = createPostgresCheckpointAssetManifestRepairService(pool);
  const counts = {};
  let scanned = 0;
  let cursor = null;

  try {
    do {
      const batch = options.apply
        ? await service.applyBatch({ cursor, batchSize: options.batchSize })
        : await service.preflightBatch({
            cursor,
            batchSize: options.batchSize,
          });
      for (const item of batch.items) {
        scanned += 1;
        counts[item.action] = (counts[item.action] ?? 0) + 1;
        console.log(
          JSON.stringify({
            event: "checkpoint_asset_manifest_repair_item",
            runId,
            mode,
            ...item,
          }),
        );
      }
      cursor = batch.nextCursor;
    } while (cursor);

    console.log(
      JSON.stringify({
        event: "checkpoint_asset_manifest_repair_summary",
        runId,
        mode,
        batchSize: options.batchSize,
        scanned,
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
