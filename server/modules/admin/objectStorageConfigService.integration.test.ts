import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPostgresPool, type DbPool } from "../../dist/db/postgres.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createObjectStorageCredentialKeyring } from "../../dist/modules/assets/objectStorageCredentials.js";
import { createPostgresAdminObjectStorageConfigService } from "../../dist/modules/admin/objectStorageConfigService.js";
import { createUnavailableAdminService } from "../../dist/modules/admin/service.js";

loadDotEnv();
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

test(
  "managed object storage tests, publishes encrypted credentials, preserves keys and restores environment atomically",
  {
    skip: databaseUrl
      ? false
      : "MIGRATION_DATABASE_URL or DATABASE_URL is not configured",
  },
  async (context) => {
    const ownerPool = createPostgresPool({ connectionString: databaseUrl! });
    const client = await ownerPool.connect();
    const available = await client.query(
      `SELECT to_regclass('admin.object_storage_config_revisions') AS revisions`,
    );
    if (!available.rows[0]?.revisions) {
      context.skip("managed object storage migration is not applied");
      client.release();
      await ownerPool.end();
      return;
    }

    const adminId = `storage-admin-${randomUUID()}`;
    const adminUsername = `storage_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const session = {
      admin: {
        id: adminId,
        username: adminUsername,
        role: "super_admin" as const,
        status: "active" as const,
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const adminService = {
      ...createUnavailableAdminService(),
      async requirePermission() {
        return session;
      },
    };
    let savepointActive = false;
    const transactionalPool = {
      query: client.query.bind(client),
      async connect() {
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text === "BEGIN") {
              savepointActive = true;
              return client.query("SAVEPOINT object_storage_config_service_tx");
            }
            if (text === "COMMIT") {
              savepointActive = false;
              return client.query(
                "RELEASE SAVEPOINT object_storage_config_service_tx",
              );
            }
            if (text === "ROLLBACK") {
              if (!savepointActive) return client.query("SELECT 1");
              savepointActive = false;
              await client.query(
                "ROLLBACK TO SAVEPOINT object_storage_config_service_tx",
              );
              return client.query(
                "RELEASE SAVEPOINT object_storage_config_service_tx",
              );
            }
            return client.query(text, values);
          },
          release() {},
        };
      },
    } as unknown as DbPool;

    const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
    const fallback = {
      endpoint,
      publicEndpoint,
      publicOrigin:
        process.env.S3_PUBLIC_ORIGIN ?? new URL(publicEndpoint).origin,
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "test-assets",
      forcePathStyle:
        (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "environment-access",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "environment-secret",
    };
    const testedCredentials: Array<[string, string]> = [];
    let invalidations = 0;
    const service = createPostgresAdminObjectStorageConfigService(
      transactionalPool,
      {
        adminService,
        keyring: createObjectStorageCredentialKeyring({
          developmentSecret: "object-storage-config-integration-key",
        }),
        fallbackConfig: fallback,
        auditSecret: "object-storage-config-integration-audit-secret",
        invalidateManagedConfig() {
          invalidations += 1;
        },
        async testStorage(config) {
          testedCredentials.push([config.accessKeyId, config.secretAccessKey]);
        },
      },
    );
    const requestContext = {
      requestId: `object-storage-config-${randomUUID()}`,
      ipAddress: "192.0.2.20",
      userAgent: "Object Storage Config Integration",
    };
    const baseInput = {
      endpoint: fallback.endpoint,
      publicEndpoint: fallback.publicEndpoint,
      publicOrigin: fallback.publicOrigin,
      region: fallback.region,
      bucket: fallback.bucket,
      forcePathStyle: fallback.forcePathStyle,
      accessKeyId: "managed-access",
      secretAccessKey: "managed-secret",
      expectedRevisionId: null,
    };
    const rotatedPublicOrigin = fallback.forcePathStyle
      ? "https://storage.example.com"
      : `https://${fallback.bucket}.storage.example.com`;

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO admin, public");
      await client.query(
        `INSERT INTO admin."user" (id, name, email, username, display_username, role)
         VALUES ($1, 'Storage Admin', $2, $3, $3, 'super_admin')`,
        [adminId, `${adminId}@example.invalid`, adminUsername],
      );
      await client.query(
        "DELETE FROM public.object_storage_config_publications",
      );
      await client.query("DELETE FROM admin.object_storage_config_current");

      const environment = await service.getCurrent(requestContext);
      assert.equal(environment.source, "environment");
      assert.equal("accessKeyId" in environment, false);

      await service.testConnection(baseInput, requestContext);
      const published = await service.publish(baseInput, requestContext);
      assert.equal(published.source, "managed");
      assert.equal(published.credentialsConfigured, true);
      assert.deepEqual(testedCredentials.at(-1), [
        "managed-access",
        "managed-secret",
      ]);

      const stored = await client.query<{ document: string }>(
        `SELECT encrypted_credentials_json::text AS document
         FROM admin.object_storage_config_revisions WHERE id = $1`,
        [published.revisionId],
      );
      assert.equal(stored.rows[0]?.document.includes("managed-secret"), false);
      assert.equal(stored.rows[0]?.document.includes("managed-access"), false);

      const rotated = await service.publish(
        {
          ...baseInput,
          accessKeyId: undefined,
          secretAccessKey: undefined,
          publicEndpoint: "https://storage.example.com",
          publicOrigin: rotatedPublicOrigin,
          expectedRevisionId: published.revisionId,
        },
        requestContext,
      );
      assert.equal(rotated.publicOrigin, rotatedPublicOrigin);
      assert.deepEqual(testedCredentials.at(-1), [
        "managed-access",
        "managed-secret",
      ]);

      const restored = await service.restoreEnvironment(
        { expectedRevisionId: rotated.revisionId! },
        requestContext,
      );
      assert.equal(restored.source, "environment");
      assert.equal(restored.revisionId, null);
      assert.equal(invalidations, 3);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await ownerPool.end();
    }
  },
);
