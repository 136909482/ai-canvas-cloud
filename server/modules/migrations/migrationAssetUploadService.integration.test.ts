import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresMigrationAssetUploadService } from "../../dist/modules/migrations/migrationAssetUploadService.js";
import { readWorkspaceStorageUsage } from "../../dist/modules/workspaces/usage.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMPORT_ID = "77777777-7777-4777-8777-777777777777";

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

class FakeMigrationObjectStorage {
  objects = new Map<
    string,
    { byteSize: number; mimeType: string; sha256: string }
  >();
  lastObjectKey: string | null = null;
  multipartUploadIds: string[] = [];
  completedMultipart: Array<{
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }> = [];
  deletedKeys: string[] = [];

  async createPresignedUpload(input: {
    objectKey: string;
    mimeType: string;
    byteSize: number;
    expiresInSeconds: number;
  }) {
    this.lastObjectKey = input.objectKey;
    return {
      method: "PUT" as const,
      url: `https://storage.invalid/put/${encodeURIComponent(input.objectKey)}`,
      headers: { "content-type": input.mimeType },
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async initiateMultipartUpload() {
    const uploadId = `multipart-${this.multipartUploadIds.length + 1}`;
    this.multipartUploadIds.push(uploadId);
    return { uploadId };
  }

  async createPresignedUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    byteSize: number;
    expiresInSeconds: number;
  }) {
    this.lastObjectKey = input.objectKey;
    return {
      url: `https://storage.invalid/part/${input.uploadId}/${input.partNumber}`,
      headers: { "content-length": String(input.byteSize) },
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    this.completedMultipart.push(input);
  }

  async abortMultipartUpload(input: { objectKey: string; uploadId: string }) {
    this.deletedKeys.push(input.objectKey);
  }

  async getObjectMetadata(objectKey: string) {
    const object = this.objects.get(objectKey);
    if (!object) throw new Error("missing object");
    return { byteSize: object.byteSize, mimeType: object.mimeType };
  }

  async calculateObjectSha256(objectKey: string) {
    const object = this.objects.get(objectKey);
    if (!object) throw new Error("missing object");
    return object.sha256;
  }

  async deleteObject(objectKey: string) {
    this.deletedKeys.push(objectKey);
    this.objects.delete(objectKey);
  }
}

test(
  "migration asset uploads are resumable, validated, isolated, and reservation-safe",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `migration_asset_upload_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
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
        .filter(
          (fileName) =>
            fileName.endsWith(".sql") &&
            !/^(?:002[5-9]|0030|003[235])_/.test(fileName),
        )
        .sort();
      for (const fileName of migrations) {
        await pool.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
      }
      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('migration-upload-a', 'Upload A', 'migration-upload-a@example.com', true),
             ('migration-upload-b', 'Upload B', 'migration-upload-b@example.com', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id, storage_quota_bytes)
      VALUES ($1, 'Upload A', 'migration-upload-a', 33554432),
             ($2, 'Upload B', 'migration-upload-b', 33554432)
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'migration-upload-a', 'owner'), ($2, 'migration-upload-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );

      const small = Buffer.from("migration-small-asset");
      const largeSize = 8 * 1024 * 1024 + 1;
      const largeHash = "b".repeat(64);
      const assetManifest = {
        schemaVersion: 1,
        assets: [
          {
            logicalAssetId: "small-asset",
            filePath: "assets/small-asset.png",
            originalFileName: "small.png",
            mimeType: "image/png",
            byteSize: small.byteLength,
            sha256: sha256(small),
            width: 1,
            height: 1,
            assetKind: "upload",
          },
          {
            logicalAssetId: "large-asset",
            filePath: "assets/large-asset.mp4",
            originalFileName: "large.mp4",
            mimeType: "video/mp4",
            byteSize: largeSize,
            sha256: largeHash,
            width: null,
            height: null,
            assetKind: "video",
          },
        ],
      };
      await pool.query(
        `
      INSERT INTO migration_imports (
        id, workspace_id, created_by_user_id, package_schema_version, package_id,
        source_platform, source_project_id, source_project_version, source_project_sequence,
        project_name, request_fingerprint, content_sha256, idempotency_key,
        asset_count, total_file_count, total_bytes, estimated_storage_bytes,
        available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
        asset_manifest_json, expires_at
      ) VALUES (
        $1, $2, 'migration-upload-a', 1, 'upload-package', 'electron', 'legacy-upload', 0, 0,
        'Upload package', repeat('a', 64), repeat('b', 64), 'upload-import', 2, 6, $3, $3,
        33554432, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $4::jsonb, now() + interval '1 day'
      )
    `,
        [
          IMPORT_ID,
          WORKSPACE_A,
          small.byteLength + largeSize,
          JSON.stringify(assetManifest),
        ],
      );

      const storage = new FakeMigrationObjectStorage();
      const service = createPostgresMigrationAssetUploadService(pool, storage);
      const actorA = { userId: "migration-upload-a", workspaceId: WORKSPACE_A };
      const actorB = { userId: "migration-upload-b", workspaceId: WORKSPACE_B };

      const smallPrepared = await service.prepareAssetUpload(
        IMPORT_ID,
        "small-asset",
        actorA,
      );
      assert.equal(smallPrepared.upload.mode, "single");
      assert.equal(smallPrepared.upload.parts.length, 0);
      assert(
        smallPrepared.upload.directUpload?.url.includes("storage.invalid"),
      );
      assert.equal("objectKey" in smallPrepared.upload, false);
      assert.equal(
        (await readWorkspaceStorageUsage(pool, WORKSPACE_A)).storage
          .reservedBytes,
        small.byteLength,
      );

      const smallKey = storage.lastObjectKey!;
      storage.objects.set(smallKey, {
        byteSize: small.byteLength,
        mimeType: "image/png",
        sha256: sha256(small),
      });
      const smallCompleted = await service.completeAssetUpload(
        IMPORT_ID,
        "small-asset",
        undefined,
        actorA,
      );
      assert.equal(smallCompleted.upload.status, "completed");
      assert.deepEqual(
        (
          await service.completeAssetUpload(
            IMPORT_ID,
            "small-asset",
            {},
            actorA,
          )
        ).upload.completedParts,
        [],
      );

      const largePrepared = await service.prepareAssetUpload(
        IMPORT_ID,
        "large-asset",
        actorA,
      );
      assert.equal(largePrepared.upload.mode, "multipart");
      assert.equal(largePrepared.upload.partCount, 2);
      assert.equal(largePrepared.upload.parts.length, 2);
      assert.equal("providerUploadId" in largePrepared.upload, false);
      const largeKey = storage.lastObjectKey!;
      await service.completeAssetPart(
        IMPORT_ID,
        "large-asset",
        1,
        { etag: "etag-1", byteSize: 8 * 1024 * 1024 },
        actorA,
      );
      const resumed = await service.getAssetUpload(
        IMPORT_ID,
        "large-asset",
        actorA,
      );
      assert.deepEqual(resumed.upload.completedParts, [1]);
      assert.equal(resumed.upload.parts.length, 1);
      await service.completeAssetPart(
        IMPORT_ID,
        "large-asset",
        2,
        { etag: "etag-2", byteSize: 1 },
        actorA,
      );
      storage.objects.set(largeKey, {
        byteSize: largeSize,
        mimeType: "video/mp4",
        sha256: "c".repeat(64),
      });
      await assert.rejects(
        () =>
          service.completeAssetUpload(
            IMPORT_ID,
            "large-asset",
            undefined,
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "ASSET_VALIDATION_FAILED",
      );
      assert.equal(
        (await service.getAssetUpload(IMPORT_ID, "large-asset", actorA)).upload
          .status,
        "failed",
      );
      const retried = await service.prepareAssetUpload(
        IMPORT_ID,
        "large-asset",
        actorA,
      );
      assert.equal(retried.upload.status, "uploading");
      assert.equal(retried.upload.retryCount, 1);
      const retriedLargeKey = storage.lastObjectKey!;
      assert.notEqual(retriedLargeKey, largeKey);
      await service.completeAssetPart(
        IMPORT_ID,
        "large-asset",
        1,
        { etag: "etag-retry-1", byteSize: 8 * 1024 * 1024 },
        actorA,
      );
      await service.completeAssetPart(
        IMPORT_ID,
        "large-asset",
        2,
        { etag: "etag-retry-2", byteSize: 1 },
        actorA,
      );
      storage.objects.set(retriedLargeKey, {
        byteSize: largeSize,
        mimeType: "video/mp4",
        sha256: largeHash,
      });
      const largeCompleted = await service.completeAssetUpload(
        IMPORT_ID,
        "large-asset",
        undefined,
        actorA,
      );
      assert.equal(largeCompleted.upload.status, "completed");
      assert.equal(storage.completedMultipart.length, 2);
      assert.deepEqual(
        (
          await pool.query(
            `SELECT status FROM migration_imports WHERE id = $1`,
            [IMPORT_ID],
          )
        ).rows[0],
        { status: "ready" },
      );
      assert.equal(
        (await pool.query(`SELECT count(*)::integer AS count FROM assets`))
          .rows[0]?.count,
        0,
      );
      assert.equal(
        (await readWorkspaceStorageUsage(pool, WORKSPACE_A)).storage
          .reservedBytes,
        small.byteLength + largeSize,
      );
      const deletedBeforeCompletedCancel = [...storage.deletedKeys];
      assert.equal(
        (await service.cancelAssetUpload(IMPORT_ID, "small-asset", actorA))
          .upload.status,
        "completed",
      );
      assert.deepEqual(storage.deletedKeys, deletedBeforeCompletedCancel);

      await assert.rejects(
        () => service.getAssetUpload(IMPORT_ID, "small-asset", actorB),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );

      const cancelImportId = "88888888-8888-4888-8888-888888888888";
      await pool.query(
        `
      INSERT INTO migration_imports (
        id, workspace_id, created_by_user_id, package_schema_version, package_id,
        source_platform, source_project_id, source_project_version, source_project_sequence,
        project_name, request_fingerprint, content_sha256, idempotency_key,
        asset_count, total_file_count, total_bytes, estimated_storage_bytes,
        available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
        asset_manifest_json, expires_at
      ) VALUES ($1, $2, 'migration-upload-a', 1, 'cancel-package', 'electron', 'cancel-project', 0, 0,
        'Cancel package', repeat('c', 64), repeat('d', 64), 'cancel-import', 1, 5, 1, 1, 33554432,
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"schemaVersion":1,"assets":[{"logicalAssetId":"cancel-asset","filePath":"assets/cancel-asset.png","originalFileName":"cancel.png","mimeType":"image/png","byteSize":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","width":1,"height":1,"assetKind":"upload"}]}'::jsonb,
        now() + interval '1 day')
    `,
        [cancelImportId, WORKSPACE_A],
      );
      await service.prepareAssetUpload(cancelImportId, "cancel-asset", actorA);
      const canceled = await service.cancelAssetUpload(
        cancelImportId,
        "cancel-asset",
        actorA,
      );
      assert.equal(canceled.upload.status, "canceled");
      assert(storage.deletedKeys.length >= 1);
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
