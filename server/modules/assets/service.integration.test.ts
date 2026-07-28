import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import {
  createPostgresAssetService,
  type AssetObjectStorage,
} from "../../dist/modules/assets/service.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL asset reads require completed state and isolate two workspaces",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `asset_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
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
        ('asset-user-a', 'A', 'a-asset-test@example.com', true),
        ('asset-viewer-a', 'A viewer', 'a-viewer-asset-test@example.com', true),
        ('asset-user-b', 'B', 'b-asset-test@example.com', true)
    `);
      await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A workspace', 'asset-user-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B workspace', 'asset-user-b')
    `);
      await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'asset-user-a', 'owner'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'asset-viewer-a', 'viewer'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'asset-user-b', 'owner')
    `);

      const downloadKeys: string[] = [];
      const objectStorage: AssetObjectStorage = {
        async createPresignedUpload(input) {
          return {
            method: "PUT",
            url: `https://storage.test/upload/${encodeURIComponent(input.objectKey)}`,
            headers: { "content-type": input.mimeType },
            expiresAt: new Date(
              Date.now() + input.expiresInSeconds * 1000,
            ).toISOString(),
          };
        },
        async createPresignedDownload(input) {
          downloadKeys.push(input.objectKey);
          return {
            url: `https://storage.test/read/${encodeURIComponent(input.objectKey)}`,
            expiresAt: new Date(
              Date.now() + input.expiresInSeconds * 1000,
            ).toISOString(),
          };
        },
        async getObjectMetadata() {
          return { byteSize: 4, mimeType: "image/png" };
        },
        async calculateObjectSha256() {
          throw new Error(
            "SHA-256 should not be requested when no digest was declared",
          );
        },
      };

      const projects = createPostgresProjectService(pool);
      const assets = createPostgresAssetService(pool, {
        objectStorage,
        readUrlTtlSeconds: 300,
      });
      const actorA = {
        userId: "asset-user-a",
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
      const viewerA = {
        userId: "asset-viewer-a",
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
      const actorB = {
        userId: "asset-user-b",
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      };
      const projectA = (
        await projects.createProject({ name: "Asset A" }, actorA)
      ).project;
      const created = await assets.createUpload(
        {
          projectId: projectA.id,
          originalFileName: "reference.png",
          mimeType: "image/png",
          byteSize: 4,
          assetKind: "upload",
          idempotencyKey: "asset_read_test",
        },
        actorA,
      );
      const generated = await assets.createUpload(
        {
          projectId: projectA.id,
          originalFileName: "generated.webp",
          mimeType: "image/webp",
          byteSize: 4,
          assetKind: "generated",
          idempotencyKey: "asset_generated_path_test",
        },
        actorA,
      );
      assert.match(
        decodeURIComponent(generated.directUpload.url),
        /\/generated\/\d{4}-\d{2}-\d{2}\//,
      );

      const missingMime = await assets.createUpload(
        {
          projectId: projectA.id,
          originalFileName: "missing-mime.png",
          mimeType: "image/png",
          byteSize: 4,
          assetKind: "upload",
          idempotencyKey: "asset_missing_mime_test",
        },
        actorA,
      );
      objectStorage.getObjectMetadata = async () => ({
        byteSize: 4,
        mimeType: null,
      });
      await assert.rejects(
        () => assets.completeUpload(missingMime.upload.id, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 422 &&
          error.apiCode === "ASSET_VALIDATION_FAILED",
      );
      objectStorage.getObjectMetadata = async () => ({
        byteSize: 4,
        mimeType: "image/png",
      });

      await assert.rejects(
        () => assets.getAssetUrl(created.asset.id, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "ASSET_NOT_READY",
      );

      await assets.completeUpload(created.upload.id, actorA);
      const metadata = await assets.getAsset(created.asset.id, viewerA);
      assert.equal(metadata.asset.status, "completed");
      assert.equal(metadata.asset.id, created.asset.id);
      assert.equal("objectKey" in metadata.asset, false);

      const read = await assets.getAssetUrl(created.asset.id, viewerA);
      assert.equal(read.assetId, created.asset.id);
      assert.match(read.url, /^https:\/\/storage\.test\/read\//);
      assert.equal(downloadKeys.length, 1);

      for (const crossWorkspaceRead of [assets.getAsset, assets.getAssetUrl]) {
        await assert.rejects(
          () => crossWorkspaceRead(created.asset.id, actorB),
          (error: unknown) =>
            error instanceof AuthServiceError &&
            error.statusCode === 404 &&
            error.apiCode === "RESOURCE_NOT_FOUND",
        );
      }
      assert.equal(downloadKeys.length, 1);
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
