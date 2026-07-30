import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresPool } from "../server/dist/db/postgres.js";
import { loadDotEnv } from "../server/dist/env/loadDotEnv.js";
import {
  ACCOUNT_ERASURE_DEFAULT_BATCH_SIZE,
  ACCOUNT_ERASURE_MAX_BATCH_SIZE,
  createPostgresAccountErasureMaintenanceService,
} from "../server/dist/modules/admin/index.js";
import { createS3ObjectStorage } from "../server/dist/modules/assets/index.js";

export function parseAccountErasureMaintenanceArgs(args) {
  let apply = false;
  let batchSize = ACCOUNT_ERASURE_DEFAULT_BATCH_SIZE;
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
    batchSize > ACCOUNT_ERASURE_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `--batch-size must be between 1 and ${ACCOUNT_ERASURE_MAX_BATCH_SIZE}`,
    );
  }
  return { help: false, apply, batchSize };
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name} for account erasure maintenance`);
  return value;
}

async function main() {
  const options = parseAccountErasureMaintenanceArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: npm run db:maintain:accounts -- [--apply] [--batch-size=<1-100>]\n\nPreflight is read-only. --apply purges only due account-erasure jobs and retries failed object cleanup on a later run.",
    );
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
  try {
    const summary = await createPostgresAccountErasureMaintenanceService(
      pool,
      storage,
    ).run(options);
    console.log(
      JSON.stringify({ event: "account_erasure_maintenance", ...summary }),
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
