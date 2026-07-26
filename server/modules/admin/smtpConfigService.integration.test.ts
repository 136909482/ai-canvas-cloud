import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import { createPostgresPool, type DbPool } from "../../dist/db/postgres.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createUnavailableAdminService } from "../../dist/modules/admin/service.js";
import { createPostgresAdminSmtpConfigService } from "../../dist/modules/admin/smtpConfigService.js";
import {
  createSmtpCredentialKeyring,
  SmtpTransportError,
} from "../../dist/modules/mail/smtp.js";

loadDotEnv();
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

test(
  "managed SMTP publishes encrypted revisions, preserves passwords, tests, limits and disables atomically",
  {
    skip: databaseUrl
      ? false
      : "MIGRATION_DATABASE_URL or DATABASE_URL is not configured",
  },
  async (context) => {
    const ownerPool = createPostgresPool({ connectionString: databaseUrl! });
    const client = await ownerPool.connect();
    const available = await client.query(
      `SELECT to_regclass('admin.smtp_config_revisions') AS revisions`,
    );
    if (!available.rows[0]?.revisions) {
      context.skip("managed SMTP migration is not applied");
      client.release();
      await ownerPool.end();
      return;
    }

    const adminId = `smtp-admin-${randomUUID()}`;
    const adminUsername = `smtp_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
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
              return client.query("SAVEPOINT smtp_config_service_tx");
            }
            if (text === "COMMIT") {
              savepointActive = false;
              return client.query("RELEASE SAVEPOINT smtp_config_service_tx");
            }
            if (text === "ROLLBACK") {
              if (!savepointActive) return client.query("SELECT 1");
              savepointActive = false;
              await client.query(
                "ROLLBACK TO SAVEPOINT smtp_config_service_tx",
              );
              return client.query("RELEASE SAVEPOINT smtp_config_service_tx");
            }
            return client.query(text, values);
          },
          release() {},
        };
      },
    } as unknown as DbPool;
    const verifiedPasswords: string[] = [];
    const deliveredPasswords: string[] = [];
    const metrics = createMetricsRegistry();
    let verificationFailure: SmtpTransportError | null = null;
    const service = createPostgresAdminSmtpConfigService(transactionalPool, {
      adminService,
      keyring: createSmtpCredentialKeyring({
        developmentSecret: "smtp-config-integration-key",
      }),
      auditSecret: "smtp-config-integration-audit-secret",
      async verifyConnection(config) {
        verifiedPasswords.push(config.password);
        if (verificationFailure) throw verificationFailure;
      },
      async sendMessage(config) {
        deliveredPasswords.push(config.password);
      },
      metrics,
    });
    const requestContext = {
      requestId: `smtp-config-${randomUUID()}`,
      ipAddress: "192.0.2.10",
      userAgent: "SMTP Config Integration",
    };
    const baseInput = {
      host: "smtp.example.com",
      port: 465,
      securityMode: "implicit_tls" as const,
      username: "mailer@example.com",
      password: "integration-password",
      fromEmail: "noreply@example.com",
      fromName: "AI Canvas",
      expectedRevisionId: null,
    };

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO admin, public");
      await client.query(
        `INSERT INTO admin."user" (id, name, email, username, display_username, role)
         VALUES ($1, 'SMTP Admin', $2, $3, $3, 'super_admin')`,
        [adminId, `${adminId}@example.invalid`, adminUsername],
      );
      await client.query("DELETE FROM public.smtp_config_publications");
      await client.query("DELETE FROM admin.smtp_config_current");

      assert.equal(
        (await service.getCurrent(requestContext)).state,
        "unconfigured",
      );
      await service.testConnection(baseInput, requestContext);
      const published = await service.publish(baseInput, requestContext);
      assert.equal(published.state, "active");
      assert.equal(published.passwordConfigured, true);
      assert.equal(verifiedPasswords.at(-1), "integration-password");

      const stored = await client.query<{ document: string }>(
        `SELECT encrypted_password_json::text AS document
         FROM admin.smtp_config_revisions WHERE id = $1`,
        [published.revisionId],
      );
      assert.equal(
        stored.rows[0]?.document.includes("integration-password"),
        false,
      );

      const withoutPassword = {
        ...baseInput,
        password: undefined,
        port: 587,
        securityMode: "starttls" as const,
        expectedRevisionId: published.revisionId,
      };
      const updated = await service.publish(withoutPassword, requestContext);
      assert.equal(updated.port, 587);
      assert.equal(verifiedPasswords.at(-1), "integration-password");
      await assert.rejects(
        () =>
          service.testEmail(
            {
              ...withoutPassword,
              expectedRevisionId: published.revisionId,
              recipient: "test@example.com",
            },
            requestContext,
          ),
        (error: unknown) =>
          (error as { code?: string }).code === "SMTP_CONFIG_CONFLICT",
      );
      await service.testEmail(
        {
          ...withoutPassword,
          expectedRevisionId: updated.revisionId,
          recipient: "test@example.com",
        },
        requestContext,
      );
      assert.equal(deliveredPasswords.at(-1), "integration-password");

      await assert.rejects(
        () =>
          service.publish({ ...withoutPassword, port: 2525 }, requestContext),
        (error: unknown) =>
          (error as { code?: string }).code === "SMTP_CONFIG_CONFLICT",
      );

      verificationFailure = new SmtpTransportError("authentication");
      await assert.rejects(
        () =>
          service.publish(
            {
              ...withoutPassword,
              port: 2525,
              expectedRevisionId: updated.revisionId,
            },
            requestContext,
          ),
        (error: unknown) =>
          (error as { code?: string }).code === "SMTP_AUTH_FAILED",
      );
      assert.equal(
        (await service.getCurrent(requestContext)).revisionId,
        updated.revisionId,
      );

      await assert.rejects(
        () =>
          service.testConnection(
            { ...withoutPassword, expectedRevisionId: updated.revisionId },
            requestContext,
          ),
        (error: unknown) =>
          (error as { code?: string }).code === "SMTP_AUTH_FAILED",
      );
      verificationFailure = null;
      await service.testConnection(
        { ...withoutPassword, expectedRevisionId: updated.revisionId },
        requestContext,
      );
      await assert.rejects(
        () =>
          service.testConnection(
            { ...withoutPassword, expectedRevisionId: updated.revisionId },
            requestContext,
          ),
        (error: unknown) =>
          (error as { code?: string }).code === "SMTP_RATE_LIMITED",
      );

      const testAttemptColumns = await client.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'admin' AND table_name = 'smtp_test_attempts'
      `);
      assert.equal(
        testAttemptColumns.rows.some(({ column_name }) =>
          ["recipient", "email", "password", "host"].includes(column_name),
        ),
        false,
      );
      const renderedMetrics = metrics.renderPrometheus();
      assert.match(renderedMetrics, /operation="test"/);
      assert.match(renderedMetrics, /reason="authentication"/);
      assert.doesNotMatch(
        renderedMetrics,
        /integration-password|test@example\.com|smtp\.example\.com/,
      );

      const disabled = await service.disable(
        { expectedRevisionId: updated.revisionId! },
        requestContext,
      );
      assert.equal(disabled.state, "disabled");
      const publication = await client.query<{
        enabled: boolean;
        document: string;
      }>(
        `SELECT enabled, encrypted_password_json::text AS document
         FROM public.smtp_config_publications WHERE singleton_id = 1`,
      );
      assert.equal(publication.rows[0]?.enabled, false);
      assert.equal(
        publication.rows[0]?.document.includes("integration-password"),
        false,
      );
      await assert.rejects(
        () =>
          client.query(
            `UPDATE admin.smtp_config_revisions SET host = host WHERE id = $1`,
            [disabled.revisionId],
          ),
        /immutable/i,
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await ownerPool.end();
    }
  },
);
