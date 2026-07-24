import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import {
  assertRestoreIsolation,
  createRecoveryFingerprint,
  requiredEnv,
} from "./recovery-common.mjs";

const migrationsDirectory = join(process.cwd(), "server", "db", "migrations");

async function scalar(client, query, values = []) {
  const result = await client.query(query, values);
  return Number(Object.values(result.rows[0] ?? {})[0] ?? 0);
}

export async function auditDatabaseConsistency(
  client,
  expectedMigrationCount,
  minimumWorkspaces,
) {
  const failures = [];
  const appliedMigrations = await scalar(
    client,
    "SELECT count(*)::integer FROM schema_migrations",
  );
  if (appliedMigrations !== expectedMigrationCount)
    failures.push("schema_migrations");
  if (!Number.isInteger(minimumWorkspaces) || minimumWorkspaces < 0)
    throw new Error("minimumWorkspaces must be non-negative");
  if (
    (await scalar(client, "SELECT count(*)::integer FROM workspaces")) <
    minimumWorkspaces
  )
    failures.push("workspace_count");

  const checks = [
    [
      "workspace_owners",
      `SELECT count(*)::integer FROM workspaces w LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = w.owner_user_id AND wm.role = 'owner' WHERE wm.user_id IS NULL`,
    ],
    [
      "project_counts",
      `SELECT count(*)::integer FROM projects p WHERE p.node_count <> (SELECT count(*) FROM project_nodes n WHERE n.project_id = p.id AND n.deleted_at IS NULL) OR p.edge_count <> (SELECT count(*) FROM project_edges e WHERE e.project_id = p.id AND e.deleted_at IS NULL)`,
    ],
    [
      "project_versions",
      `SELECT count(*)::integer FROM projects p WHERE p.version < COALESCE((SELECT max(result_version) FROM project_changes c WHERE c.project_id = p.id), 0) OR p.last_sequence < COALESCE((SELECT max(sequence) FROM project_changes c WHERE c.project_id = p.id), 0)`,
    ],
    [
      "dangling_active_edges",
      `SELECT count(*)::integer FROM project_edges e LEFT JOIN project_nodes s ON s.project_id = e.project_id AND s.node_id = e.source_node_id AND s.deleted_at IS NULL LEFT JOIN project_nodes t ON t.project_id = e.project_id AND t.node_id = e.target_node_id AND t.deleted_at IS NULL WHERE e.deleted_at IS NULL AND (s.node_id IS NULL OR t.node_id IS NULL)`,
    ],
    [
      "invalid_asset_references",
      `SELECT count(*)::integer FROM asset_references r JOIN assets a ON a.workspace_id = r.workspace_id AND a.id = r.asset_id JOIN projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id WHERE a.status <> 'completed' OR a.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL`,
    ],
    [
      "invalid_checkpoint_assets",
      `SELECT count(*)::integer FROM project_snapshots s JOIN projects p ON p.id = s.project_id CROSS JOIN LATERAL jsonb_array_elements_text(s.asset_manifest_json) entry LEFT JOIN assets a ON a.id::text = entry AND a.workspace_id = p.workspace_id WHERE s.is_valid AND (a.id IS NULL OR a.status <> 'completed' OR a.deleted_at IS NOT NULL)`,
    ],
    [
      "protected_deleted_assets",
      `SELECT count(*)::integer FROM assets a WHERE a.deleted_at IS NOT NULL AND (EXISTS (SELECT 1 FROM asset_references r WHERE r.asset_id = a.id AND r.workspace_id = a.workspace_id) OR EXISTS (SELECT 1 FROM project_snapshots s JOIN projects p ON p.id = s.project_id CROSS JOIN LATERAL jsonb_array_elements_text(s.asset_manifest_json) entry WHERE s.is_valid AND p.workspace_id = a.workspace_id AND entry = a.id::text))`,
    ],
    [
      "migration_import_states",
      `SELECT count(*)::integer FROM migration_imports WHERE (status = 'completed') <> (committed_at IS NOT NULL)`,
    ],
    [
      "migration_export_states",
      `SELECT count(*)::integer FROM migration_exports WHERE (status = 'completed') <> (archive_object_key IS NOT NULL AND completed_at IS NOT NULL)`,
    ],
  ];
  for (const [name, query] of checks) {
    if ((await scalar(client, query)) > 0) failures.push(name);
  }
  return failures;
}

export async function auditRestoredState(
  env = process.env,
  expectedFingerprint,
) {
  assertRestoreIsolation(env);
  const client = new pg.Client({
    connectionString: requiredEnv(env, "RESTORE_DATABASE_URL"),
  });
  const storage = new S3Client({
    endpoint: requiredEnv(env, "RESTORE_S3_ENDPOINT"),
    region: requiredEnv(env, "S3_REGION"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv(env, "RESTORE_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "RESTORE_S3_SECRET_ACCESS_KEY"),
    },
  });
  let failures = [];
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrationFiles = readdirSync(migrationsDirectory).filter((name) =>
      /^\d{4}_[a-z0-9_]+\.sql$/.test(name),
    );
    const minimumWorkspaces = Number(env.RESTORE_AUDIT_MIN_WORKSPACES ?? "2");
    if (!Number.isInteger(minimumWorkspaces) || minimumWorkspaces < 2)
      throw new Error("RESTORE_AUDIT_MIN_WORKSPACES must be at least 2");
    failures = await auditDatabaseConsistency(
      client,
      migrationFiles.length,
      minimumWorkspaces,
    );

    const objectRows = await client.query(`
      SELECT object_key FROM assets WHERE status = 'completed' AND deleted_at IS NULL
      UNION SELECT u.object_key FROM migration_import_asset_uploads u JOIN migration_imports i ON i.id = u.import_id AND i.workspace_id = u.workspace_id WHERE i.status IN ('prepared', 'uploading', 'validating', 'ready') AND u.status IN ('pending', 'uploading', 'validating', 'completed') AND u.committed_asset_id IS NULL
      UNION SELECT archive_object_key FROM migration_exports WHERE status = 'completed' AND archive_object_key IS NOT NULL
    `);
    let missingObjects = 0;
    for (const row of objectRows.rows) {
      try {
        await storage.send(
          new HeadObjectCommand({
            Bucket: requiredEnv(env, "RESTORE_S3_BUCKET"),
            Key: row.object_key,
          }),
        );
      } catch {
        missingObjects += 1;
      }
    }
    if (missingObjects > 0) failures.push("missing_objects");

    const fingerprint = await createRecoveryFingerprint(client);
    if (
      expectedFingerprint &&
      JSON.stringify(fingerprint) !== JSON.stringify(expectedFingerprint)
    )
      failures.push("fingerprint_mismatch");
    await client.query("COMMIT");
    const result = {
      ok: failures.length === 0,
      failures,
      checkedObjects: objectRows.rowCount,
      missingObjects,
      fingerprint,
    };
    if (!result.ok)
      throw Object.assign(new Error("Restored state audit failed"), {
        auditResult: result,
      });
    return result;
  } finally {
    await client.end().catch(() => undefined);
    storage.destroy();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  auditRestoredState()
    .then((result) => {
      console.log(
        JSON.stringify({
          event: "restore_audit_completed",
          checkedObjects: result.checkedObjects,
        }),
      );
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          event: "restore_audit_failed",
          failures: error.auditResult?.failures ?? [
            error instanceof Error ? error.name : "UnknownError",
          ],
        }),
      );
      process.exitCode = 1;
    });
}
