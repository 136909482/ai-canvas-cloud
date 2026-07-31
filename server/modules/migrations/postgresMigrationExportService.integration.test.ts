import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import {
  createMigrationPackageContentDigestInput,
  validateMigrationPackageContract,
} from "@ai-canvas-cloud/contracts";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresMigrationExportService } from "../../dist/modules/migrations/postgresMigrationExportService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "55555555-5555-4555-8555-555555555555";

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function readStoredZip(body: Uint8Array) {
  const buffer = Buffer.from(body);
  const files: Array<{ path: string; body: Buffer }> = [];
  let offset = 0;
  while (
    offset + 4 <= buffer.byteLength &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const bodyStart = offset + 30 + nameLength + extraLength;
    files.push({
      path: name,
      body: buffer.subarray(bodyStart, bodyStart + compressedSize),
    });
    offset = bodyStart + compressedSize;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return files;
}

async function waitForCompletion(
  service: ReturnType<typeof createPostgresMigrationExportService>,
  exportId: string,
  actor: { userId: string; workspaceId: string },
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await service.getExport(PROJECT_ID, exportId, actor);
    if (
      response.export.status === "completed" ||
      response.export.status === "failed" ||
      response.export.status === "canceled"
    ) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for migration export");
}

test(
  "migration export freezes one project version and produces an import-compatible private archive",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `migration_export_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
    const assetBytes = Buffer.from("export-asset-bytes");
    const objectKey = `workspaces/${WORKSPACE_A}/projects/${PROJECT_ID}/uploads/${ASSET_ID}.png`;
    const objects = new Map<string, Uint8Array>([[objectKey, assetBytes]]);
    const storage = {
      async getObjectBytes(input: { objectKey: string }) {
        const body = objects.get(input.objectKey);
        if (!body) throw new Error("missing object");
        return body;
      },
      async putObject(input: { objectKey: string; body: Uint8Array }) {
        objects.set(input.objectKey, input.body);
      },
      async createPresignedDownload(input: { objectKey: string }) {
        return {
          url: `https://storage.test/download/${encodeURIComponent(input.objectKey)}`,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      },
      async deleteObject(input: string) {
        objects.delete(input);
      },
    };
    const owner = { userId: "export-owner-a", workspaceId: WORKSPACE_A };
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 30_000,
        max: 4,
        options: `-c search_path=${schemaName},public`,
      });
      const migrations = (
        await readdir(join(process.cwd(), "server", "db", "migrations"))
      )
        .filter((fileName) => fileName.endsWith(".sql"))
        .sort();
      for (const fileName of migrations) {
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
      VALUES ('export-owner-a', 'Export A', 'export-a@example.com', true, 'export_owner_a', 'export_owner_a'),
             ('export-owner-b', 'Export B', 'export-b@example.com', true, 'export_owner_b', 'export_owner_b')
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id, storage_quota_bytes)
      VALUES ($1, 'Export A', 'export-owner-a', 100000), ($2, 'Export B', 'export-owner-b', 100000)
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'export-owner-a', 'owner'), ($2, 'export-owner-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO projects (id, workspace_id, name, version, last_sequence, node_count, edge_count)
      VALUES ($1, $2, 'Export project', 1, 1, 1, 0)
    `,
        [PROJECT_ID, WORKSPACE_A],
      );
      await pool.query(
        `
      INSERT INTO project_nodes (
        project_id, node_id, node_type, position_x, position_y, data_schema_version, data_json
      ) VALUES ($1, 'node-1', 'imageNode', 0, 0, 1, $2::jsonb)
    `,
        [
          PROJECT_ID,
          JSON.stringify({
            imageAsset: {
              assetId: ASSET_ID,
              relativePath: `cloud-assets/${ASSET_ID}`,
            },
          }),
        ],
      );
      await pool.query(
        `
      INSERT INTO assets (
        id, workspace_id, origin_project_id, created_by_user_id, object_key, original_file_name,
        mime_type, byte_size, sha256, width, height, asset_kind, status
      ) VALUES ($1, $2, $3, 'export-owner-a', $4, 'source.png', 'image/png', $5, $6, 1, 1, 'upload', 'completed')
    `,
        [
          ASSET_ID,
          WORKSPACE_A,
          PROJECT_ID,
          objectKey,
          assetBytes.byteLength,
          sha256(assetBytes),
        ],
      );
      await pool.query(
        `
      INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
      VALUES ($1, $2, $3, 'node-1', 'source')
    `,
        [WORKSPACE_A, ASSET_ID, PROJECT_ID],
      );
      const snapshotId = (
        await pool.query<{ id: string }>(
          `
      INSERT INTO project_snapshots (
        project_id, project_version, last_sequence, snapshot_type, schema_version,
        record_json, byte_size, asset_manifest_json, is_valid
      ) VALUES ($1, 1, 1, 'manual', 1, $2::jsonb, 10, $3::jsonb, true)
      RETURNING id::text
    `,
          [
            PROJECT_ID,
            JSON.stringify({
              schemaVersion: 1,
              project: {
                id: PROJECT_ID,
                name: "Export project",
                version: 1,
                lastSequence: 1,
              },
              canvas: {
                nodes: [
                  {
                    id: "node-1",
                    nodeType: "imageNode",
                    position: { x: 0, y: 0 },
                    dataSchemaVersion: 1,
                    data: {
                      imageAsset: {
                        assetId: ASSET_ID,
                        relativePath: `cloud-assets/${ASSET_ID}`,
                      },
                    },
                  },
                ],
                edges: [],
              },
              taskQueue: { tasks: [] },
            }),
            JSON.stringify([ASSET_ID]),
          ],
        )
      ).rows[0]!.id;
      await pool.query(
        `UPDATE projects SET saved_snapshot_id = $2 WHERE id = $1`,
        [PROJECT_ID, snapshotId],
      );

      const service = createPostgresMigrationExportService(pool, storage);
      const prepared = await service.prepareExport(
        PROJECT_ID,
        { idempotencyKey: "export-1", expectedVersion: 1, expectedSequence: 1 },
        owner,
      );
      assert.equal(prepared.export.status, "prepared");
      assert.equal(prepared.export.project.version, 1);
      const replay = await service.prepareExport(
        PROJECT_ID,
        { idempotencyKey: "export-1", expectedVersion: 1, expectedSequence: 1 },
        owner,
      );
      assert.equal(replay.export.id, prepared.export.id);
      await assert.rejects(
        () =>
          service.prepareExport(
            PROJECT_ID,
            {
              idempotencyKey: "export-1",
              expectedVersion: 0,
              expectedSequence: 1,
            },
            owner,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "EXPORT_CONFLICT",
      );
      await pool.query(
        `UPDATE projects SET version = 2, last_sequence = 2 WHERE id = $1`,
        [PROJECT_ID],
      );
      const completed = await waitForCompletion(
        service,
        prepared.export.id,
        owner,
      );
      assert.equal(
        completed.export.status,
        "completed",
        JSON.stringify(completed),
      );
      assert.equal(completed.export.project.version, 1);
      assert(completed.export.archive);
      assert.equal(
        completed.export.progress.completedFileCount,
        completed.export.progress.fileCount,
      );
      const download = await service.downloadExport(
        PROJECT_ID,
        prepared.export.id,
        owner,
      );
      assert.equal(download.exportId, prepared.export.id);
      assert.equal(
        JSON.stringify(download).includes(
          `workspaces/${WORKSPACE_A}/migration-exports`,
        ),
        false,
      );

      const archiveKey = `workspaces/${WORKSPACE_A}/migration-exports/${prepared.export.id}/package.zip`;
      const archive = objects.get(archiveKey);
      assert(archive);
      const files = readStoredZip(archive);
      const byPath = new Map(files.map((file) => [file.path, file.body]));
      const manifest = JSON.parse(
        byPath.get("manifest.json")!.toString("utf8"),
      );
      const projectRecord = JSON.parse(
        byPath.get("project.json")!.toString("utf8"),
      );
      const graph = JSON.parse(byPath.get("graph.json")!.toString("utf8"));
      const assetManifest = JSON.parse(
        byPath.get("assets.json")!.toString("utf8"),
      );
      const checkpoint = byPath.has("checkpoint.json")
        ? JSON.parse(byPath.get("checkpoint.json")!.toString("utf8"))
        : null;
      const descriptors = manifest.files.map(
        (file: { path: string; byteSize: number; sha256: string }) => ({
          ...file,
        }),
      );
      assert.equal(manifest.project.version, 1);
      assert.equal(
        graph.nodes[0].data.imageAsset.assetId.startsWith("asset-"),
        true,
      );
      assert.equal(
        graph.nodes[0].data.imageAsset.relativePath.startsWith("assets/"),
        true,
      );
      assert.equal(JSON.stringify(projectRecord).includes(objectKey), false);
      assert.equal(
        JSON.stringify(projectRecord).includes(ASSET_ID),
        false,
        JSON.stringify(projectRecord),
      );
      validateMigrationPackageContract({
        manifest,
        projectRecord,
        graph,
        assetManifest,
        checkpoint,
        archiveEntries: files.map((file) => ({
          path: file.path,
          kind: "file",
          uncompressedSize: file.body.byteLength,
          compressedSize: file.body.byteLength,
          sha256: sha256(file.body),
        })),
      });
      assert.equal(
        manifest.contentSha256,
        sha256(createMigrationPackageContentDigestInput(descriptors)),
      );
      await assert.rejects(
        () =>
          service.getExport(PROJECT_ID, prepared.export.id, {
            userId: "export-owner-b",
            workspaceId: WORKSPACE_B,
          }),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () =>
          service.getExport(
            "22222222-2222-4222-8222-222222222222",
            prepared.export.id,
            owner,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );

      objects.set(objectKey, Buffer.from("changed"));
      const failedPrepared = await service.prepareExport(
        PROJECT_ID,
        { idempotencyKey: "export-failure" },
        owner,
      );
      const failed = await waitForCompletion(
        service,
        failedPrepared.export.id,
        owner,
      );
      assert.equal(failed.export.status, "failed");
      objects.set(objectKey, assetBytes);
      const retried = await service.retryExport(
        PROJECT_ID,
        failedPrepared.export.id,
        owner,
      );
      assert.equal(retried.export.status, "prepared");
      assert.equal(retried.export.progress.retryCount, 1);
      const recovered = await waitForCompletion(
        service,
        failedPrepared.export.id,
        owner,
      );
      assert.equal(recovered.export.status, "completed");
      assert.equal(recovered.export.progress.retryCount, 1);
      assert.equal(
        Number(
          (
            await pool.query(
              `SELECT version, last_sequence FROM projects WHERE id = $1`,
              [PROJECT_ID],
            )
          ).rows[0]?.version,
        ),
        2,
      );
    } finally {
      await pool?.end();
      if (admin.readyForQuery)
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  },
);
