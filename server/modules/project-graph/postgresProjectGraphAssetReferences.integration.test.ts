import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectGraphService } from "../../dist/modules/project-graph/postgresProjectGraphService.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPLETED_SOURCE = "11111111-1111-4111-8111-111111111111";
const COMPLETED_RESULT = "22222222-2222-4222-8222-222222222222";
const COMPLETED_THUMBNAIL = "33333333-3333-4333-8333-333333333333";
const PENDING_ASSET = "44444444-4444-4444-8444-444444444444";
const FAILED_ASSET = "55555555-5555-4555-8555-555555555555";
const QUARANTINED_ASSET = "66666666-6666-4666-8666-666666666666";
const CROSS_WORKSPACE_ASSET = "77777777-7777-4777-8777-777777777777";
const MISSING_ASSET = "88888888-8888-4888-8888-888888888888";

test(
  "PostgreSQL graph transactions validate and replace node asset references atomically",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `graph_asset_test_${randomUUID().replaceAll("-", "")}`;
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
        .filter((fileName) => fileName.endsWith(".sql"))
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          isolateCurrentSchemaSql(
            await readFile(
              join(process.cwd(), "server", "db", "migrations", fileName),
              "utf8",
            ),
            schemaName,
          ),
        );
      }

      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified, username, display_username)
      VALUES
        ('graph-asset-user-a', 'A', 'a-graph-assets@example.com', true, 'graph_asset_a', 'graph_asset_a'),
        ('graph-asset-user-b', 'B', 'b-graph-assets@example.com', true, 'graph_asset_b', 'graph_asset_b')
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ($1, 'A workspace', 'graph-asset-user-a'),
        ($2, 'B workspace', 'graph-asset-user-b')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'graph-asset-user-a', 'owner'),
        ($2, 'graph-asset-user-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );

      const projects = createPostgresProjectService(pool);
      const graphs = createPostgresProjectGraphService(pool);
      const actorA = { userId: "graph-asset-user-a", workspaceId: WORKSPACE_A };
      const actorB = { userId: "graph-asset-user-b", workspaceId: WORKSPACE_B };
      const projectA = (
        await projects.createProject({ name: "Asset graph A" }, actorA)
      ).project;
      const projectB = (
        await projects.createProject({ name: "Asset graph B" }, actorB)
      ).project;

      const insertAsset = async (input: {
        id: string;
        workspaceId: string;
        projectId: string;
        userId: string;
        status: "pending" | "completed" | "failed" | "quarantined";
        kind?: "upload" | "generated" | "thumbnail";
      }) => {
        await pool!.query(
          `
          INSERT INTO assets (
            id, workspace_id, origin_project_id, created_by_user_id, object_key,
            original_file_name, mime_type, byte_size, asset_kind, status
          ) VALUES ($1, $2, $3, $4, $5, 'asset.png', 'image/png', 128, $6, $7)
        `,
          [
            input.id,
            input.workspaceId,
            input.projectId,
            input.userId,
            `workspaces/${input.workspaceId}/projects/${input.projectId}/assets/${input.id}.png`,
            input.kind ?? "upload",
            input.status,
          ],
        );
      };

      await insertAsset({
        id: COMPLETED_SOURCE,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "completed",
      });
      await insertAsset({
        id: COMPLETED_RESULT,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "completed",
        kind: "generated",
      });
      await insertAsset({
        id: COMPLETED_THUMBNAIL,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "completed",
        kind: "thumbnail",
      });
      await insertAsset({
        id: PENDING_ASSET,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "pending",
      });
      await insertAsset({
        id: FAILED_ASSET,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "failed",
      });
      await insertAsset({
        id: QUARANTINED_ASSET,
        workspaceId: WORKSPACE_A,
        projectId: projectA.id,
        userId: actorA.userId,
        status: "quarantined",
      });
      await insertAsset({
        id: CROSS_WORKSPACE_ASSET,
        workspaceId: WORKSPACE_B,
        projectId: projectB.id,
        userId: actorB.userId,
        status: "completed",
      });

      const firstBatch = {
        baseVersion: 0,
        clientId: "asset-browser-a",
        batchId: "asset-batch-1",
        idempotencyKey: "asset-graph-1",
        operations: [
          {
            type: "upsertNode" as const,
            node: {
              id: "node-media",
              nodeType: "imageNode",
              position: { x: 0, y: 0 },
              dataSchemaVersion: 1,
              data: {
                imageUrl: "blob:http://localhost/runtime-only",
                imageAsset: {
                  assetId: COMPLETED_SOURCE,
                  relativePath: `cloud-assets/${COMPLETED_SOURCE}`,
                  thumbnailRelativePath: `cloud-assets/${COMPLETED_THUMBNAIL}`,
                  objectKey: "forged/object-key.png",
                  assetKind: "upload",
                },
              },
            },
          },
        ],
      };
      const firstAccepted = await graphs.applyOperations(
        projectA.id,
        firstBatch,
        actorA,
      );
      assert.equal(firstAccepted.version, 1);
      assert.deepEqual(
        (
          await pool.query(
            `SELECT asset_id::text, reference_role FROM asset_references WHERE project_id = $1 ORDER BY reference_role`,
            [projectA.id],
          )
        ).rows,
        [
          { asset_id: COMPLETED_SOURCE, reference_role: "source" },
          { asset_id: COMPLETED_THUMBNAIL, reference_role: "thumbnail" },
        ],
      );

      const replacementBatch = {
        baseVersion: 1,
        clientId: "asset-browser-a",
        batchId: "asset-batch-2",
        idempotencyKey: "asset-graph-2",
        operations: [
          {
            type: "upsertNode" as const,
            node: {
              id: "node-media",
              nodeType: "generatedPreviewNode",
              position: { x: 20, y: 10 },
              dataSchemaVersion: 1,
              data: {
                imageUrl: "https://storage.example/presigned-runtime-url",
                imageAsset: {
                  assetId: COMPLETED_RESULT,
                  relativePath: `cloud-assets/${COMPLETED_RESULT}`,
                  assetKind: "generated",
                },
              },
            },
          },
        ],
      };
      const replacementAccepted = await graphs.applyOperations(
        projectA.id,
        replacementBatch,
        actorA,
      );
      assert.equal(replacementAccepted.version, 2);
      assert.deepEqual(
        await graphs.applyOperations(projectA.id, replacementBatch, actorA),
        replacementAccepted,
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT asset_id::text, reference_role FROM asset_references WHERE project_id = $1`,
            [projectA.id],
          )
        ).rows,
        [{ asset_id: COMPLETED_RESULT, reference_role: "result" }],
      );

      const assertUnchangedAtVersionTwo = async () => {
        const state = (
          await pool!.query(
            `SELECT version, last_sequence, node_count, edge_count FROM projects WHERE id = $1`,
            [projectA.id],
          )
        ).rows[0];
        assert.deepEqual(state, {
          version: "2",
          last_sequence: "2",
          node_count: 1,
          edge_count: 0,
        });
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
          [{ asset_id: COMPLETED_RESULT, reference_role: "result" }],
        );
      };

      await assert.rejects(
        () =>
          graphs.applyOperations(
            projectA.id,
            {
              baseVersion: 2,
              clientId: "asset-browser-a",
              batchId: "asset-batch-pending-atomic",
              idempotencyKey: "asset-graph-pending-atomic",
              operations: [
                {
                  type: "upsertNode",
                  node: {
                    id: "node-invalid",
                    nodeType: "imageNode",
                    position: { x: 100, y: 0 },
                    dataSchemaVersion: 1,
                    data: { imageAsset: { assetId: PENDING_ASSET } },
                  },
                },
                {
                  type: "upsertEdge",
                  edge: {
                    id: "edge-invalid",
                    source: "node-media",
                    target: "node-invalid",
                  },
                },
              ],
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
            `SELECT 1 FROM project_nodes WHERE project_id = $1 AND node_id = 'node-invalid'`,
            [projectA.id],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM project_edges WHERE project_id = $1 AND edge_id = 'edge-invalid'`,
            [projectA.id],
          )
        ).rowCount,
        0,
      );
      await assertUnchangedAtVersionTwo();

      for (const [assetId, suffix] of [
        [FAILED_ASSET, "failed"],
        [QUARANTINED_ASSET, "quarantined"],
      ] as const) {
        await assert.rejects(
          () =>
            graphs.applyOperations(
              projectA.id,
              {
                baseVersion: 2,
                clientId: "asset-browser-a",
                batchId: `asset-batch-${suffix}`,
                idempotencyKey: `asset-graph-${suffix}`,
                operations: [
                  {
                    type: "upsertNode",
                    node: {
                      ...replacementBatch.operations[0]!.node,
                      data: { imageAsset: { assetId } },
                    },
                  },
                ],
              },
              actorA,
            ),
          (error: unknown) =>
            error instanceof AuthServiceError &&
            error.statusCode === 409 &&
            error.apiCode === "ASSET_NOT_READY",
        );
        await assertUnchangedAtVersionTwo();
      }

      for (const [assetId, suffix] of [
        [CROSS_WORKSPACE_ASSET, "cross"],
        [MISSING_ASSET, "missing"],
      ] as const) {
        await assert.rejects(
          () =>
            graphs.applyOperations(
              projectA.id,
              {
                baseVersion: 2,
                clientId: "asset-browser-a",
                batchId: `asset-batch-${suffix}`,
                idempotencyKey: `asset-graph-${suffix}`,
                operations: [
                  {
                    type: "upsertNode",
                    node: {
                      ...replacementBatch.operations[0]!.node,
                      data: { imageAsset: { assetId } },
                    },
                  },
                ],
              },
              actorA,
            ),
          (error: unknown) =>
            error instanceof AuthServiceError &&
            error.statusCode === 404 &&
            error.apiCode === "RESOURCE_NOT_FOUND" &&
            error.message === "Referenced asset not found",
        );
        await assertUnchangedAtVersionTwo();
      }

      await pool.query(
        `UPDATE assets SET origin_project_id = NULL WHERE id = $1`,
        [COMPLETED_RESULT],
      );

      const deleted = await graphs.applyOperations(
        projectA.id,
        {
          baseVersion: 2,
          clientId: "asset-browser-a",
          batchId: "asset-batch-delete",
          idempotencyKey: "asset-graph-delete",
          operations: [{ type: "deleteNode", nodeId: "node-media" }],
        },
        actorA,
      );
      assert.equal(deleted.version, 3);
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM asset_references WHERE project_id = $1`,
            [projectA.id],
          )
        ).rowCount,
        0,
      );
      assert.ok(
        (
          await pool.query(
            `SELECT quota_released_at FROM assets WHERE id = $1`,
            [COMPLETED_RESULT],
          )
        ).rows[0]?.quota_released_at,
      );

      const restoreBatch = {
        ...replacementBatch,
        baseVersion: 3,
        batchId: "asset-batch-restore",
        idempotencyKey: "asset-graph-restore",
      };
      await pool.query(
        `UPDATE workspaces SET storage_quota_bytes = 0 WHERE id = $1`,
        [WORKSPACE_A],
      );
      await assert.rejects(
        () => graphs.applyOperations(projectA.id, restoreBatch, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "QUOTA_EXCEEDED",
      );
      await pool.query(
        `UPDATE workspaces SET storage_quota_bytes = 10737418240 WHERE id = $1`,
        [WORKSPACE_A],
      );
      const restored = await graphs.applyOperations(
        projectA.id,
        restoreBatch,
        actorA,
      );
      assert.equal(restored.version, 4);
      assert.equal(
        (
          await pool.query(
            `SELECT quota_released_at FROM assets WHERE id = $1`,
            [COMPLETED_RESULT],
          )
        ).rows[0]?.quota_released_at,
        null,
      );
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
