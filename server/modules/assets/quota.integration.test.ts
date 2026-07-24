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
import { createPostgresWorkspaceUsageService } from "../../dist/modules/workspaces/usage.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test(
  "PostgreSQL upload reservations enforce workspace quota atomically and idempotently",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `asset_quota_test_${randomUUID().replaceAll("-", "")}`;
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
            fileName.endsWith(".sql") && !/^(?:002[5-9]|0030)_/.test(fileName),
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
        ('quota-user-a', 'A', 'quota-a@example.com', true),
        ('quota-user-b', 'B', 'quota-b@example.com', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id, storage_quota_bytes)
      VALUES
        ($1, 'Quota A', 'quota-user-a', 100),
        ($2, 'Quota B', 'quota-user-b', 100)
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'quota-user-a', 'owner'),
        ($2, 'quota-user-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      );

      const objectSizes = new Map<string, number>();
      let signedUploadCount = 0;
      const objectStorage: AssetObjectStorage = {
        async createPresignedUpload(input) {
          signedUploadCount += 1;
          objectSizes.set(input.objectKey, input.byteSize);
          return {
            method: "PUT",
            url: `https://storage.test/upload/${encodeURIComponent(input.objectKey)}`,
            headers: { "content-type": input.mimeType },
            expiresAt: new Date(
              Date.now() + input.expiresInSeconds * 1000,
            ).toISOString(),
          };
        },
        async createPresignedDownload() {
          throw new Error("Download signing is not expected");
        },
        async getObjectMetadata(objectKey) {
          return {
            byteSize: objectSizes.get(objectKey) ?? 0,
            mimeType: "image/png",
          };
        },
        async calculateObjectSha256() {
          throw new Error("SHA-256 is not expected");
        },
      };

      const projects = createPostgresProjectService(pool);
      const assets = createPostgresAssetService(pool, { objectStorage });
      const usage = createPostgresWorkspaceUsageService(pool);
      const actorA = { userId: "quota-user-a", workspaceId: WORKSPACE_A };
      const actorB = { userId: "quota-user-b", workspaceId: WORKSPACE_B };
      const projectA = (
        await projects.createProject({ name: "Quota A" }, actorA)
      ).project;
      const projectB = (
        await projects.createProject({ name: "Quota B" }, actorB)
      ).project;
      const request = (
        projectId: string,
        byteSize: number,
        idempotencyKey: string,
      ) => ({
        projectId,
        originalFileName: `${idempotencyKey}.png`,
        mimeType: "image/png",
        byteSize,
        assetKind: "upload" as const,
        idempotencyKey,
      });

      const first = await assets.createUpload(
        request(projectA.id, 60, "quota-first"),
        actorA,
      );
      const repeated = await assets.createUpload(
        request(projectA.id, 60, "quota-first"),
        actorA,
      );
      assert.equal(repeated.asset.id, first.asset.id);
      assert.equal(
        (await usage.getCurrentUsage(actorA)).storage.reservedBytes,
        60,
      );

      const signedBeforeRejected = signedUploadCount;
      await assert.rejects(
        () =>
          assets.createUpload(request(projectA.id, 41, "quota-over"), actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "QUOTA_EXCEEDED" &&
          error.details?.availableBytes === 40,
      );
      assert.equal(signedUploadCount, signedBeforeRejected);
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM assets WHERE workspace_id = $1`,
            [WORKSPACE_A],
          )
        ).rows[0]?.count,
        1,
      );

      await assets.createUpload(
        request(projectA.id, 40, "quota-exact"),
        actorA,
      );
      assert.equal(
        (await usage.getCurrentUsage(actorA)).storage.totalBytes,
        100,
      );
      await assets.completeUpload(first.upload.id, actorA);
      assert.deepEqual((await usage.getCurrentUsage(actorA)).storage, {
        usedBytes: 60,
        reservedBytes: 40,
        totalBytes: 100,
        quotaBytes: 100,
        availableBytes: 0,
      });

      const concurrent = await Promise.allSettled([
        assets.createUpload(
          request(projectB.id, 60, "quota-concurrent-a"),
          actorB,
        ),
        assets.createUpload(
          request(projectB.id, 60, "quota-concurrent-b"),
          actorB,
        ),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejection = concurrent.find(
        (result) => result.status === "rejected",
      );
      assert(rejection && rejection.status === "rejected");
      assert(rejection.reason instanceof AuthServiceError);
      assert.equal(rejection.reason.apiCode, "QUOTA_EXCEEDED");
      assert.equal(
        (await usage.getCurrentUsage(actorB)).storage.totalBytes,
        60,
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
