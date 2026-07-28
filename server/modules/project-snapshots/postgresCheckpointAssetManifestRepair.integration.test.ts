import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createPostgresCheckpointAssetManifestRepairService } from "../../dist/modules/project-snapshots/postgresCheckpointAssetManifestRepair.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_SAVED_INVALID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ASSET_COMPLETED = "11111111-1111-4111-8111-111111111111";
const ASSET_CROSS_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ASSET_PENDING = "33333333-3333-4333-8333-333333333333";
const ASSET_FAILED = "44444444-4444-4444-8444-444444444444";
const ASSET_QUARANTINED = "55555555-5555-4555-8555-555555555555";
const ASSET_MISSING = "66666666-6666-4666-8666-666666666666";
const ASSET_DELETED = "77777777-7777-4777-8777-777777777777";

const SNAPSHOTS = {
  empty: "10000000-0000-4000-8000-000000000001",
  mismatch: "10000000-0000-4000-8000-000000000002",
  duplicate: "10000000-0000-4000-8000-000000000003",
  damagedRecord: "10000000-0000-4000-8000-000000000004",
  crossWorkspace: "10000000-0000-4000-8000-000000000005",
  missing: "10000000-0000-4000-8000-000000000006",
  pending: "10000000-0000-4000-8000-000000000007",
  failed: "10000000-0000-4000-8000-000000000008",
  quarantined: "10000000-0000-4000-8000-000000000009",
  damagedManifest: "10000000-0000-4000-8000-000000000010",
  consistent: "10000000-0000-4000-8000-000000000011",
  alreadyInvalid: "10000000-0000-4000-8000-000000000012",
  deleted: "10000000-0000-4000-8000-000000000013",
} as const;

function checkpointRecord(projectId: string, assetId: string) {
  return {
    schemaVersion: 1,
    project: {
      id: projectId,
      name: "Historical checkpoint",
      version: 1,
      lastSequence: 1,
    },
    canvas: {
      nodes: [
        {
          id: "node-history",
          nodeType: "imageNode",
          position: { x: 10, y: 20 },
          dataSchemaVersion: 1,
          data: {
            imageAsset: { assetId, relativePath: `cloud-assets/${assetId}` },
          },
        },
      ],
      edges: [],
    },
    taskQueue: { tasks: [] },
  };
}

test(
  "PostgreSQL checkpoint asset repair is tenant-safe, batched, idempotent and preserves saved pointers and current graph",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `snapshot_repair_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 4,
        options: `-c search_path=${schemaName},public`,
      });

      const migrationFiles = (
        await readdir(join(process.cwd(), "server", "db", "migrations"))
      )
        .filter(
          (fileName) =>
            fileName.endsWith(".sql") &&
            !/^(?:002[5-9]|0030|003[235])_/.test(fileName),
        )
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
      }

      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('repair-user-a', 'A', 'repair-a@example.com', true),
        ('repair-user-b', 'B', 'repair-b@example.com', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ($1, 'Repair A', 'repair-user-a'),
        ($2, 'Repair B', 'repair-user-b')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'repair-user-a', 'owner'),
        ($2, 'repair-user-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO projects (id, workspace_id, name, version, last_sequence, node_count)
      VALUES
        ($1, $4, 'Current graph', 7, 5, 1),
        ($2, $4, 'Saved invalid', 0, 0, 0),
        ($3, $5, 'Other tenant', 0, 0, 0)
    `,
        [PROJECT_A, PROJECT_SAVED_INVALID, PROJECT_B, WORKSPACE_A, WORKSPACE_B],
      );

      const assets = [
        [ASSET_COMPLETED, WORKSPACE_A, PROJECT_A, "repair-user-a", "completed"],
        [
          ASSET_CROSS_WORKSPACE,
          WORKSPACE_B,
          PROJECT_B,
          "repair-user-b",
          "completed",
        ],
        [ASSET_PENDING, WORKSPACE_A, PROJECT_A, "repair-user-a", "pending"],
        [ASSET_FAILED, WORKSPACE_A, PROJECT_A, "repair-user-a", "failed"],
        [
          ASSET_QUARANTINED,
          WORKSPACE_A,
          PROJECT_A,
          "repair-user-a",
          "quarantined",
        ],
        [ASSET_DELETED, WORKSPACE_A, PROJECT_A, "repair-user-a", "completed"],
      ];
      for (const [assetId, workspaceId, projectId, userId, status] of assets) {
        await pool.query(
          `
        INSERT INTO assets (
          id, workspace_id, origin_project_id, created_by_user_id, object_key,
          original_file_name, mime_type, byte_size, asset_kind, status
        ) VALUES ($1, $2, $3, $4, $5, 'asset.png', 'image/png', 128, 'upload', $6)
      `,
          [
            assetId,
            workspaceId,
            projectId,
            userId,
            `workspaces/${workspaceId}/assets/${assetId}.png`,
            status,
          ],
        );
      }
      await pool.query(
        `UPDATE assets SET status = 'deleted', deleted_at = now() WHERE id = $1`,
        [ASSET_DELETED],
      );

      const currentNodeData = { imageAsset: { assetId: ASSET_COMPLETED } };
      await pool.query(
        `
      INSERT INTO project_nodes (
        project_id, node_id, node_type, position_x, position_y, data_schema_version, data_json
      ) VALUES ($1, 'node-current', 'imageNode', 5, 6, 1, $2::jsonb)
    `,
        [PROJECT_A, JSON.stringify(currentNodeData)],
      );
      await pool.query(
        `
      INSERT INTO project_changes (
        project_id, sequence, base_version, result_version, batch_id,
        idempotency_key, source, operations_json
      ) VALUES ($1, 5, 6, 7, 'existing-change', 'existing-change', 'system', '[]'::jsonb)
    `,
        [PROJECT_A],
      );
      await pool.query(
        `
      INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
      VALUES ($1, $2, $3, 'node-current', 'source')
    `,
        [WORKSPACE_A, ASSET_COMPLETED, PROJECT_A],
      );

      const snapshotRows: Array<{
        id: string;
        projectId: string;
        record: unknown;
        manifest: unknown[];
        isValid: boolean;
      }> = [
        {
          id: SNAPSHOTS.empty,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.mismatch,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: [ASSET_PENDING],
          isValid: true,
        },
        {
          id: SNAPSHOTS.duplicate,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: [ASSET_COMPLETED, ASSET_COMPLETED],
          isValid: true,
        },
        {
          id: SNAPSHOTS.damagedRecord,
          projectId: PROJECT_SAVED_INVALID,
          record: {
            schemaVersion: 1,
            project: { id: PROJECT_SAVED_INVALID },
            canvas: { nodes: {} },
          },
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.crossWorkspace,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_CROSS_WORKSPACE),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.missing,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_MISSING),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.pending,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_PENDING),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.failed,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_FAILED),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.quarantined,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_QUARANTINED),
          manifest: [],
          isValid: true,
        },
        {
          id: SNAPSHOTS.damagedManifest,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: ["invalid-id"],
          isValid: true,
        },
        {
          id: SNAPSHOTS.consistent,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: [ASSET_COMPLETED],
          isValid: true,
        },
        {
          id: SNAPSHOTS.alreadyInvalid,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_COMPLETED),
          manifest: [],
          isValid: false,
        },
        {
          id: SNAPSHOTS.deleted,
          projectId: PROJECT_A,
          record: checkpointRecord(PROJECT_A, ASSET_DELETED),
          manifest: [],
          isValid: true,
        },
      ];
      for (const [index, row] of snapshotRows.entries()) {
        await pool.query(
          `
        INSERT INTO project_snapshots (
          id, project_id, project_version, last_sequence, snapshot_type, schema_version,
          record_json, byte_size, asset_manifest_json, is_valid, created_at
        ) VALUES ($1, $2, 1, 1, 'manual', 1, $3::jsonb, $4, $5::jsonb, $6, $7::timestamptz)
      `,
          [
            row.id,
            row.projectId,
            JSON.stringify(row.record),
            Buffer.byteLength(JSON.stringify(row.record), "utf8"),
            JSON.stringify(row.manifest),
            row.isValid,
            index === 10
              ? "2026-07-16T00:10:00.123456Z"
              : `2026-07-16T00:${String(index).padStart(2, "0")}:00.000Z`,
          ],
        );
      }
      await pool.query(
        `UPDATE projects SET saved_snapshot_id = $2 WHERE id = $1`,
        [PROJECT_A, SNAPSHOTS.empty],
      );
      await pool.query(
        `UPDATE projects SET saved_snapshot_id = $2 WHERE id = $1`,
        [PROJECT_SAVED_INVALID, SNAPSHOTS.damagedRecord],
      );

      const repair = createPostgresCheckpointAssetManifestRepairService(pool);
      const collectBatches = async (
        method: "preflightBatch" | "applyBatch",
      ) => {
        const items = [];
        let cursor = null;
        do {
          const batch = await repair[method]({ cursor, batchSize: 3 });
          items.push(...batch.items);
          cursor = batch.nextCursor;
        } while (cursor);
        return items;
      };

      const currentStateBefore = {
        project: (
          await pool.query(
            `SELECT version, last_sequence, node_count, edge_count, saved_snapshot_id::text FROM projects WHERE id = $1`,
            [PROJECT_A],
          )
        ).rows[0],
        nodes: (
          await pool.query(
            `SELECT node_id, data_json, row_version FROM project_nodes WHERE project_id = $1 ORDER BY node_id`,
            [PROJECT_A],
          )
        ).rows,
        changes: (
          await pool.query(
            `SELECT sequence, base_version, result_version, operations_json FROM project_changes WHERE project_id = $1 ORDER BY sequence`,
            [PROJECT_A],
          )
        ).rows,
        references: (
          await pool.query(
            `SELECT asset_id::text, node_id, reference_role FROM asset_references WHERE project_id = $1 ORDER BY asset_id`,
            [PROJECT_A],
          )
        ).rows,
      };
      const snapshotsBeforePreflight = (
        await pool.query(
          `SELECT id::text, asset_manifest_json, is_valid FROM project_snapshots ORDER BY id`,
        )
      ).rows;

      const preflight = await collectBatches("preflightBatch");
      assert.equal(preflight.length, snapshotRows.length);
      assert.equal(
        preflight.find((item) => item.checkpointId === SNAPSHOTS.empty)?.action,
        "would_repair",
      );
      assert.equal(
        preflight.find((item) => item.checkpointId === SNAPSHOTS.damagedRecord)
          ?.action,
        "would_invalidate",
      );
      for (const id of [
        SNAPSHOTS.crossWorkspace,
        SNAPSHOTS.missing,
        SNAPSHOTS.pending,
        SNAPSHOTS.failed,
        SNAPSHOTS.quarantined,
        SNAPSHOTS.deleted,
      ]) {
        const item = preflight.find((entry) => entry.checkpointId === id);
        assert.equal(item?.action, "would_invalidate");
        assert.equal(item?.reason, "asset_unavailable");
      }
      assert.deepEqual(
        (
          await pool.query(
            `SELECT id::text, asset_manifest_json, is_valid FROM project_snapshots ORDER BY id`,
          )
        ).rows,
        snapshotsBeforePreflight,
      );

      const applied = await collectBatches("applyBatch");
      assert.equal(applied.length, snapshotRows.length);
      for (const id of [
        SNAPSHOTS.empty,
        SNAPSHOTS.mismatch,
        SNAPSHOTS.duplicate,
      ]) {
        assert.equal(
          applied.find((item) => item.checkpointId === id)?.action,
          "manifest_repaired",
        );
      }
      for (const id of [
        SNAPSHOTS.damagedRecord,
        SNAPSHOTS.crossWorkspace,
        SNAPSHOTS.missing,
        SNAPSHOTS.pending,
        SNAPSHOTS.failed,
        SNAPSHOTS.quarantined,
        SNAPSHOTS.damagedManifest,
        SNAPSHOTS.deleted,
      ]) {
        assert.equal(
          applied.find((item) => item.checkpointId === id)?.action,
          "invalidated",
        );
      }

      const repairedRows = (
        await pool.query<{
          id: string;
          asset_manifest_json: string[];
          is_valid: boolean;
        }>(
          `SELECT id::text, asset_manifest_json, is_valid FROM project_snapshots ORDER BY id`,
        )
      ).rows;
      for (const id of [
        SNAPSHOTS.empty,
        SNAPSHOTS.mismatch,
        SNAPSHOTS.duplicate,
        SNAPSHOTS.consistent,
      ]) {
        const row = repairedRows.find((entry) => entry.id === id);
        assert.deepEqual(row?.asset_manifest_json, [ASSET_COMPLETED]);
        assert.equal(row?.is_valid, true);
      }
      for (const id of [
        SNAPSHOTS.damagedRecord,
        SNAPSHOTS.crossWorkspace,
        SNAPSHOTS.missing,
        SNAPSHOTS.pending,
        SNAPSHOTS.failed,
        SNAPSHOTS.quarantined,
        SNAPSHOTS.damagedManifest,
        SNAPSHOTS.alreadyInvalid,
        SNAPSHOTS.deleted,
      ]) {
        assert.equal(
          repairedRows.find((entry) => entry.id === id)?.is_valid,
          false,
        );
      }
      assert.deepEqual(
        repairedRows.find((entry) => entry.id === SNAPSHOTS.alreadyInvalid)
          ?.asset_manifest_json,
        [],
      );

      assert.deepEqual(
        (
          await pool.query(
            `SELECT id::text, saved_snapshot_id::text FROM projects WHERE id = ANY($1::uuid[]) ORDER BY id`,
            [[PROJECT_A, PROJECT_SAVED_INVALID]],
          )
        ).rows,
        [
          { id: PROJECT_A, saved_snapshot_id: SNAPSHOTS.empty },
          {
            id: PROJECT_SAVED_INVALID,
            saved_snapshot_id: SNAPSHOTS.damagedRecord,
          },
        ],
      );

      const currentStateAfter = {
        project: (
          await pool.query(
            `SELECT version, last_sequence, node_count, edge_count, saved_snapshot_id::text FROM projects WHERE id = $1`,
            [PROJECT_A],
          )
        ).rows[0],
        nodes: (
          await pool.query(
            `SELECT node_id, data_json, row_version FROM project_nodes WHERE project_id = $1 ORDER BY node_id`,
            [PROJECT_A],
          )
        ).rows,
        changes: (
          await pool.query(
            `SELECT sequence, base_version, result_version, operations_json FROM project_changes WHERE project_id = $1 ORDER BY sequence`,
            [PROJECT_A],
          )
        ).rows,
        references: (
          await pool.query(
            `SELECT asset_id::text, node_id, reference_role FROM asset_references WHERE project_id = $1 ORDER BY asset_id`,
            [PROJECT_A],
          )
        ).rows,
      };
      assert.deepEqual(currentStateAfter, currentStateBefore);

      const repeated = await collectBatches("applyBatch");
      assert.equal(
        repeated.some(
          (item) =>
            item.action === "manifest_repaired" ||
            item.action === "invalidated",
        ),
        false,
      );

      const locker = await pool.connect();
      try {
        await locker.query("BEGIN");
        await locker.query(
          `SELECT 1 FROM project_snapshots WHERE id = $1 FOR UPDATE`,
          [SNAPSHOTS.consistent],
        );
        const lockedBatch = await repair.applyBatch({
          cursor: {
            createdAt: "2026-07-16T00:09:00.000Z",
            id: SNAPSHOTS.damagedManifest,
          },
          batchSize: 1,
        });
        assert.equal(lockedBatch.items[0]?.checkpointId, SNAPSHOTS.consistent);
        assert.equal(lockedBatch.items[0]?.action, "skipped_locked");
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
      }
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
