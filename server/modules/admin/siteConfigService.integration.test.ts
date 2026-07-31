import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createPostgresPool, type DbPool } from "../../dist/db/postgres.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createUnavailableAdminService } from "../../dist/modules/admin/service.js";
import {
  createPostgresAdminSiteConfigService,
  createPostgresPublicSiteConfigService,
  type SiteAssetObjectStorage,
} from "../../dist/modules/admin/siteConfigService.js";

loadDotEnv();
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

test(
  "site configuration publishes validated assets, immutable revisions, public projection, and audit atomically",
  {
    skip: databaseUrl
      ? false
      : "MIGRATION_DATABASE_URL or DATABASE_URL is not configured",
  },
  async (context) => {
    const ownerPool = createPostgresPool({ connectionString: databaseUrl! });
    const client = await ownerPool.connect();
    const available = await client.query(
      `SELECT to_regclass('admin.site_config_revisions') AS revisions`,
    );
    if (!available.rows[0]?.revisions) {
      context.skip("P8-3 migration is not applied to the configured database");
      client.release();
      await ownerPool.end();
      return;
    }

    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(180, 20);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const storage: SiteAssetObjectStorage = {
      async createPresignedUpload() {
        return {
          method: "PUT",
          url: "https://storage.example/upload",
          headers: { "content-type": "image/png" },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
      async createPresignedDownload() {
        return {
          url: "https://storage.example/read",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
      async getObjectMetadata() {
        return { byteSize: png.byteLength, mimeType: "image/png" };
      },
      async getObjectBytes() {
        return png;
      },
    };
    const adminId = `site-admin-${randomUUID()}`;
    const adminUsername = `site_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const session = {
      admin: {
        id: adminId,
        username: adminUsername,
        role: "operator" as const,
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
              return client.query("SAVEPOINT site_config_service_tx");
            }
            if (text === "COMMIT") {
              savepointActive = false;
              return client.query("RELEASE SAVEPOINT site_config_service_tx");
            }
            if (text === "ROLLBACK") {
              if (!savepointActive) return client.query("SELECT 1");
              savepointActive = false;
              await client.query(
                "ROLLBACK TO SAVEPOINT site_config_service_tx",
              );
              return client.query("RELEASE SAVEPOINT site_config_service_tx");
            }
            return client.query(text, values);
          },
          release() {},
        };
      },
    } as unknown as DbPool;
    const service = createPostgresAdminSiteConfigService(transactionalPool, {
      adminService,
      objectStorage: storage,
      auditSecret: "site-config-integration-audit-secret",
    });
    const requestContext = {
      requestId: `site-config-${randomUUID()}`,
      ipAddress: "192.0.2.10",
      userAgent: "Site Config Integration",
    };

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO admin, public");
      await client.query(
        `
      INSERT INTO admin."user" (id, name, email, username, display_username, role)
      VALUES ($1, 'Site Admin', $2, $3, $3, 'operator')
    `,
        [adminId, `${adminId}@example.invalid`, adminUsername],
      );
      const upload = await service.createAsset(
        {
          kind: "logo",
          originalFileName: "brand.png",
          mimeType: "image/png",
          byteSize: png.byteLength,
          sha256,
          width: 320,
          height: 180,
          idempotencyKey: `site-logo-${randomUUID()}`,
        },
        requestContext,
      );
      const completed = await service.completeAsset(
        upload.asset.id,
        requestContext,
      );
      assert.equal(completed.asset.status, "completed");

      const published = await service.publish(
        {
          config: {
            schemaVersion: 2,
            siteName: "Integration Canvas",
            shortName: "Canvas",
            home: {
              headline: "Integration Canvas",
              lead: "A published site",
              description: "Validated site configuration.",
              primaryActionLabel: "Start",
            },
            footer: {
              description: "Integration footer",
              copyright: "Copyright 2026",
            },
            records: {
              companyName: null,
              icpNumber: null,
              publicSecurityNumber: null,
            },
            links: {
              helpUrl: "https://help.example.com",
              feedbackUrl: null,
              termsUrl: null,
              privacyUrl: null,
              accountDeletionUrl: null,
            },
            themePreset: "system",
            navigation: ["home", "help", "legal"],
            features: {
              registrationEnabled: true,
              registrationEmailVerificationRequired: false,
              feedbackEnabled: false,
            },
            logoAssetId: upload.asset.id,
            faviconAssetId: null,
          },
          note: "integration publish",
        },
        requestContext,
      );
      assert.equal(published.config.siteName, "Integration Canvas");
      assert.equal(published.assets.logo?.url, "https://storage.example/read");
      assert.equal("objectKey" in published.assets.logo!, false);

      const publicProjection = await createPostgresPublicSiteConfigService(
        transactionalPool,
        storage,
      ).getCurrent();
      assert.equal(publicProjection.config.siteName, "Integration Canvas");
      assert.equal(publicProjection.assets.logo?.assetId, upload.asset.id);
      const audit = await client.query(
        `SELECT action FROM admin.audit_events WHERE request_id = $1 ORDER BY created_at`,
        [requestContext.requestId],
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        [
          "admin.site_asset.upload_created",
          "admin.site_asset.completed",
          "admin.site_config.published",
        ],
      );
      const revisions = await client.query(
        `SELECT count(*)::int AS count FROM admin.site_config_revisions WHERE created_by_admin_id = $1`,
        [adminId],
      );
      assert.equal(revisions.rows[0]?.count, 1);
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await ownerPool.end();
    }
  },
);
