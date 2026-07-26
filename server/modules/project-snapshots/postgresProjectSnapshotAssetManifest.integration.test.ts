import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectGraphService } from "../../dist/modules/project-graph/postgresProjectGraphService.js";
import { createPostgresProjectSnapshotService } from "../../dist/modules/project-snapshots/postgresProjectSnapshotService.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_A_SOURCE = "11111111-1111-4111-8111-111111111111";
const ASSET_A_RESULT = "22222222-2222-4222-8222-222222222222";
const ASSET_B = "33333333-3333-4333-8333-333333333333";
const MISSING_ASSET = "44444444-4444-4444-8444-444444444444";

test(
  "PostgreSQL checkpoints persist asset manifests and restore graph references atomically",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `snapshot_asset_test_${randomUUID().replaceAll("-", "")}`;
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
            !/^(?:002[5-9]|0030|0032)_/.test(fileName),
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
        ('snapshot-asset-user-a', 'A', 'a-snapshot-assets@example.com', true),
        ('snapshot-asset-user-b', 'B', 'b-snapshot-assets@example.com', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ($1, 'A workspace', 'snapshot-asset-user-a'),
        ($2, 'B workspace', 'snapshot-asset-user-b')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'snapshot-asset-user-a', 'owner'),
        ($2, 'snapshot-asset-user-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );

      const projects = createPostgresProjectService(pool);
      const graphs = createPostgresProjectGraphService(pool);
      const snapshots = createPostgresProjectSnapshotService(pool);
      const actorA = {
        userId: "snapshot-asset-user-a",
        workspaceId: WORKSPACE_A,
      };
      const actorB = {
        userId: "snapshot-asset-user-b",
        workspaceId: WORKSPACE_B,
      };
      const projectA = (
        await projects.createProject({ name: "Snapshot assets A" }, actorA)
      ).project;
      const projectB = (
        await projects.createProject({ name: "Snapshot assets B" }, actorB)
      ).project;

      const insertAsset = async (input: {
        id: string;
        workspaceId: string;
        projectId: string;
        userId: string;
        kind: "upload" | "generated";
      }) => {
        await pool!.query(
          `
          INSERT INTO assets (
            id, workspace_id, origin_project_id, created_by_user_id, object_key,
            original_file_name, mime_type, byte_size, asset_kind, status
          ) VALUES ($1, $2, $3, $4, $5, 'asset.png', 'image/png', 256, $6, 'completed')
        `,
          [
            input.id,
            input.workspaceId,
            input.projectId,
            input.userId,
            `workspaces/${input.workspaceId}/projects/${input.projectId}/assets/${input.id}.png`,
            input.kind,
          ],
        );
      };

      await insertAsset({
        id: ASSET_A_SOURCE,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        kind: "upload",
      });
      await insertAsset({
        id: ASSET_A_RESULT,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        kind: "generated",
      });
      await insertAsset({
        id: ASSET_B,
        workspaceId: WORKSPACE_B,
        projectId: projectB.id,
        userId: actorB.userId,
        kind: "upload",
      });

      const sourceNode = {
        id: "node-media",
        nodeType: "imageNode",
        position: { x: 0, y: 0 },
        dataSchemaVersion: 1,
        data: {
          imageAsset: {
            assetId: ASSET_A_SOURCE,
            relativePath: `cloud-assets/${ASSET_A_SOURCE}`,
            assetKind: "upload",
          },
        },
      };
      await graphs.applyOperations(
        projectA.id,
        {
          baseVersion: 0,
          clientId: "snapshot-assets-a",
          batchId: "snapshot-assets-source",
          idempotencyKey: "snapshot-assets-source",
          operations: [{ type: "upsertNode", node: sourceNode }],
        },
        actorA,
      );
      const sourceCheckpoint = await snapshots.createCheckpoint(
        projectA.id,
        {
          expectedVersion: 1,
          expectedSequence: 1,
        },
        actorA,
      );
      const repeatedCheckpoint = await snapshots.createCheckpoint(
        projectA.id,
        {
          expectedVersion: 1,
          expectedSequence: 1,
        },
        actorA,
      );
      assert.equal(
        repeatedCheckpoint.checkpoint.id,
        sourceCheckpoint.checkpoint.id,
      );
      assert.deepEqual(
        (
          await pool.query<{ asset_manifest_json: string[] }>(
            `SELECT asset_manifest_json FROM project_snapshots WHERE id = $1`,
            [sourceCheckpoint.checkpoint.id],
          )
        ).rows[0]?.asset_manifest_json,
        [ASSET_A_SOURCE],
      );

      const resultNode = {
        ...sourceNode,
        nodeType: "generatedPreviewNode",
        position: { x: 20, y: 10 },
        data: {
          imageAsset: {
            assetId: ASSET_A_RESULT,
            relativePath: `cloud-assets/${ASSET_A_RESULT}`,
            assetKind: "generated",
          },
        },
      };
      await graphs.applyOperations(
        projectA.id,
        {
          baseVersion: 1,
          clientId: "snapshot-assets-a",
          batchId: "snapshot-assets-result",
          idempotencyKey: "snapshot-assets-result",
          operations: [{ type: "upsertNode", node: resultNode }],
        },
        actorA,
      );

      const assertProjectAStillUsesResult = async () => {
        const project = (
          await pool!.query(
            `SELECT version, last_sequence FROM projects WHERE id = $1`,
            [projectA.id],
          )
        ).rows[0];
        assert.deepEqual(project, { version: "2", last_sequence: "2" });
        assert.equal(
          (
            await pool!.query(
              `SELECT 1 FROM project_changes WHERE project_id = $1`,
              [projectA.id],
            )
          ).rowCount,
          2,
        );
        assert.deepEqual(
          (
            await pool!.query(
              `SELECT asset_id::text, reference_role FROM asset_references WHERE project_id = $1`,
              [projectA.id],
            )
          ).rows,
          [{ asset_id: ASSET_A_RESULT, reference_role: "result" }],
        );
      };

      await pool.query(`UPDATE assets SET status = 'pending' WHERE id = $1`, [
        ASSET_A_SOURCE,
      ]);
      const snapshotCountBeforeRejectedRestore = (
        await pool.query(
          `SELECT count(*)::integer AS count FROM project_snapshots WHERE project_id = $1`,
          [projectA.id],
        )
      ).rows[0]!.count as number;
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            projectA.id,
            1,
            {
              expectedVersion: 2,
              expectedSequence: 2,
            },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "ASSET_NOT_READY",
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM project_snapshots WHERE project_id = $1`,
            [projectA.id],
          )
        ).rows[0]!.count,
        snapshotCountBeforeRejectedRestore,
      );
      await assertProjectAStillUsesResult();

      await pool.query(`UPDATE assets SET status = 'completed' WHERE id = $1`, [
        ASSET_A_SOURCE,
      ]);
      const restored = await snapshots.restoreRevision(
        projectA.id,
        1,
        {
          expectedVersion: 2,
          expectedSequence: 2,
        },
        actorA,
      );
      assert.equal(restored.version, 3);
      assert.deepEqual(
        (
          await pool.query<{ asset_manifest_json: string[] }>(
            `SELECT asset_manifest_json FROM project_snapshots WHERE id = $1`,
            [restored.preRestoreCheckpoint.id],
          )
        ).rows[0]?.asset_manifest_json,
        [ASSET_A_RESULT],
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT asset_id::text, reference_role FROM asset_references WHERE project_id = $1`,
            [projectA.id],
          )
        ).rows,
        [{ asset_id: ASSET_A_SOURCE, reference_role: "source" }],
      );
      const restoredGraph = await graphs.getGraph(projectA.id, actorA);
      assert.equal(restoredGraph.version, 3);
      assert.equal(
        (
          restoredGraph.nodes[0]?.data.imageAsset as
            { assetId?: string } | undefined
        )?.assetId,
        ASSET_A_SOURCE,
      );

      const validationProject = (
        await projects.createProject({ name: "Snapshot validation" }, actorA)
      ).project;
      await graphs.applyOperations(
        validationProject.id,
        {
          baseVersion: 0,
          clientId: "snapshot-validation",
          batchId: "snapshot-validation-source",
          idempotencyKey: "snapshot-validation-source",
          operations: [{ type: "upsertNode", node: sourceNode }],
        },
        actorA,
      );
      const validationCheckpoint = await snapshots.createCheckpoint(
        validationProject.id,
        {
          expectedVersion: 1,
          expectedSequence: 1,
        },
        actorA,
      );
      await graphs.applyOperations(
        validationProject.id,
        {
          baseVersion: 1,
          clientId: "snapshot-validation",
          batchId: "snapshot-validation-result",
          idempotencyKey: "snapshot-validation-result",
          operations: [{ type: "upsertNode", node: resultNode }],
        },
        actorA,
      );

      const assertValidationProjectUnchanged = async () => {
        assert.deepEqual(
          (
            await pool!.query(
              `SELECT version, last_sequence FROM projects WHERE id = $1`,
              [validationProject.id],
            )
          ).rows[0],
          { version: "2", last_sequence: "2" },
        );
        assert.equal(
          (
            await pool!.query(
              `SELECT 1 FROM project_snapshots WHERE project_id = $1`,
              [validationProject.id],
            )
          ).rowCount,
          1,
        );
        assert.deepEqual(
          (
            await pool!.query(
              `SELECT asset_id::text, reference_role FROM asset_references WHERE project_id = $1`,
              [validationProject.id],
            )
          ).rows,
          [{ asset_id: ASSET_A_RESULT, reference_role: "result" }],
        );
      };

      await pool.query(
        `UPDATE project_snapshots SET asset_manifest_json = '[]'::jsonb WHERE id = $1`,
        [validationCheckpoint.checkpoint.id],
      );
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            validationProject.id,
            1,
            {
              expectedVersion: 2,
              expectedSequence: 2,
            },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "VALIDATION_FAILED" &&
          error.message ===
            "Checkpoint asset manifest does not match its graph record",
      );
      await assertValidationProjectUnchanged();

      const targetRecord = (
        await pool.query<{ record_json: Record<string, unknown> }>(
          `SELECT record_json FROM project_snapshots WHERE id = $1`,
          [validationCheckpoint.checkpoint.id],
        )
      ).rows[0]!.record_json as {
        canvas: { nodes: Array<{ data: Record<string, unknown> }> };
      } & Record<string, unknown>;
      const setTargetAsset = async (assetId: string) => {
        targetRecord.canvas.nodes[0]!.data = { imageAsset: { assetId } };
        await pool!.query(
          `UPDATE project_snapshots SET record_json = $2::jsonb, asset_manifest_json = $3::jsonb WHERE id = $1`,
          [
            validationCheckpoint.checkpoint.id,
            JSON.stringify(targetRecord),
            JSON.stringify([assetId]),
          ],
        );
      };

      for (const assetId of [ASSET_B, MISSING_ASSET]) {
        await setTargetAsset(assetId);
        await assert.rejects(
          () =>
            snapshots.restoreRevision(
              validationProject.id,
              1,
              {
                expectedVersion: 2,
                expectedSequence: 2,
              },
              actorA,
            ),
          (error: unknown) =>
            error instanceof AuthServiceError &&
            error.statusCode === 404 &&
            error.apiCode === "RESOURCE_NOT_FOUND" &&
            error.message === "Referenced asset not found",
        );
        await assertValidationProjectUnchanged();
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
