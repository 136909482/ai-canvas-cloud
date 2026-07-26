import { randomUUID } from "node:crypto";
import type {
  DisableSmtpSettingsInput,
  SmtpSettingsInput,
  SmtpSettingsResponse,
  SmtpTestEmailInput,
  SmtpTestResponse,
} from "@ai-canvas-cloud/contracts";
import {
  validateDisableSmtpSettingsInput,
  validateSmtpSettingsInput,
  validateSmtpTestEmailInput,
} from "@ai-canvas-cloud/contracts";
import type { MetricsRegistry } from "@ai-canvas-cloud/shared";
import type { DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  sendSmtpMessage,
  SmtpTransportError,
  verifySmtpConnection,
  type SmtpCredentialEnvelope,
  type SmtpCredentialKeyring,
  type SmtpRuntimeConfig,
} from "../mail/smtp.js";
import { insertAdminAuditEvent } from "./adminAudit.js";
import { AdminAccessError } from "./security.js";
import type { AdminService } from "./service.js";
import type { AdminRequestContext, AdminSession } from "./types.js";

interface SmtpConfigRow {
  revision_id: string;
  enabled: boolean;
  host: string;
  port: number;
  security_mode: "implicit_tls" | "starttls";
  username: string;
  encrypted_password_json: SmtpCredentialEnvelope;
  from_email: string;
  from_name: string;
  updated_at: Date | string;
}

export interface AdminSmtpConfigService {
  getCurrent(context: AdminRequestContext): Promise<SmtpSettingsResponse>;
  testConnection(
    input: SmtpSettingsInput,
    context: AdminRequestContext,
  ): Promise<SmtpTestResponse>;
  testEmail(
    input: SmtpTestEmailInput,
    context: AdminRequestContext,
  ): Promise<SmtpTestResponse>;
  publish(
    input: SmtpSettingsInput,
    context: AdminRequestContext,
  ): Promise<SmtpSettingsResponse>;
  disable(
    input: DisableSmtpSettingsInput,
    context: AdminRequestContext,
  ): Promise<SmtpSettingsResponse>;
}

interface AdminSmtpConfigServiceOptions {
  adminService: AdminService;
  keyring: SmtpCredentialKeyring;
  auditSecret: string;
  fallbackConfig?: SmtpRuntimeConfig;
  verifyConnection?: typeof verifySmtpConnection;
  sendMessage?: typeof sendSmtpMessage;
  metrics?: MetricsRegistry;
}

function validationError(error: unknown) {
  return new AdminAccessError(
    400,
    "VALIDATION_FAILED",
    error instanceof Error ? error.message : "SMTP settings are invalid",
  );
}

function mapTransportError(error: unknown) {
  if (!(error instanceof SmtpTransportError)) {
    return new AdminAccessError(
      503,
      "SERVICE_UNAVAILABLE",
      "SMTP request failed",
    );
  }
  const mapped = {
    host_not_allowed: ["SMTP_HOST_NOT_ALLOWED", "SMTP host is not allowed"],
    dns: ["SMTP_DNS_FAILED", "SMTP host could not be resolved"],
    connection: ["SMTP_CONNECTION_FAILED", "SMTP connection failed"],
    tls: ["SMTP_TLS_FAILED", "SMTP TLS negotiation failed"],
    authentication: ["SMTP_AUTH_FAILED", "SMTP authentication failed"],
    sender_rejected: ["SMTP_SENDER_REJECTED", "SMTP sender was rejected"],
    recipient_rejected: [
      "SMTP_RECIPIENT_REJECTED",
      "SMTP recipient was rejected",
    ],
  }[error.category] as [AdminAccessError["code"], string];
  return new AdminAccessError(422, mapped[0], mapped[1]);
}

function responseFromRow(
  row: SmtpConfigRow | null,
  fallback?: SmtpRuntimeConfig,
): SmtpSettingsResponse {
  if (!row && fallback) {
    return {
      state: "active",
      source: "environment",
      host: fallback.host,
      port: fallback.port,
      securityMode: fallback.securityMode,
      username: fallback.username,
      passwordConfigured: true,
      fromEmail: fallback.fromEmail,
      fromName: fallback.fromName,
      revisionId: null,
      updatedAt: null,
    };
  }
  if (!row) {
    return {
      state: "unconfigured",
      source: "none",
      host: null,
      port: null,
      securityMode: null,
      username: null,
      passwordConfigured: false,
      fromEmail: null,
      fromName: null,
      revisionId: null,
      updatedAt: null,
    };
  }
  return {
    state: row.enabled ? "active" : "disabled",
    source: "managed",
    host: row.host,
    port: row.port,
    securityMode: row.security_mode,
    username: row.username,
    passwordConfigured: true,
    fromEmail: row.from_email,
    fromName: row.from_name,
    revisionId: row.revision_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readCurrent(pool: DbPool, lock = false) {
  const result = await pool.query<SmtpConfigRow>(`
    SELECT r.id::text AS revision_id, r.enabled, r.host, r.port,
           r.security_mode, r.username, r.encrypted_password_json,
           r.from_email, r.from_name, c.updated_at
    FROM admin.smtp_config_current c
    JOIN admin.smtp_config_revisions r ON r.id = c.revision_id
    WHERE c.singleton_id = 1
    ${lock ? "FOR UPDATE OF c" : ""}
  `);
  return result.rows[0] ?? null;
}

function candidateConfig(
  input: SmtpSettingsInput,
  current: SmtpConfigRow | null,
  keyring: SmtpCredentialKeyring,
): SmtpRuntimeConfig {
  const password =
    input.password ??
    (current
      ? decryptSmtpPassword(
          current.encrypted_password_json,
          current.revision_id,
          keyring,
        )
      : null);
  if (!password) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "password is required for the first managed SMTP configuration",
    );
  }
  return {
    revisionId: current?.revision_id ?? "candidate",
    host: input.host,
    port: input.port,
    securityMode: input.securityMode,
    username: input.username,
    password,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    source: "managed",
  };
}

function assertExpectedRevision(
  input: SmtpSettingsInput,
  current: SmtpConfigRow | null,
) {
  if ((current?.revision_id ?? null) !== input.expectedRevisionId) {
    throw new AdminAccessError(
      409,
      "SMTP_CONFIG_CONFLICT",
      "SMTP configuration changed; reload and try again",
    );
  }
}

async function reserveTestAttempt(
  pool: DbPool,
  session: AdminSession,
  kind: "connection" | "email",
) {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `smtp-test:${session.admin.id}`,
    ]);
    const recent = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM admin.smtp_test_attempts
       WHERE admin_user_id = $1 AND created_at > now() - interval '10 minutes'`,
      [session.admin.id],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 5) {
      throw new AdminAccessError(
        429,
        "SMTP_RATE_LIMITED",
        "Too many SMTP tests; try again later",
      );
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO admin.smtp_test_attempts (id, admin_user_id, test_kind)
       VALUES ($1, $2, $3)`,
      [id, session.admin.id, kind],
    );
    return id;
  });
}

async function completeTestAttempt(
  pool: DbPool,
  id: string,
  result: "success" | "failure",
  failureCategory?: string,
) {
  await pool.query(
    `UPDATE admin.smtp_test_attempts
     SET result = $2, failure_category = $3, completed_at = now()
     WHERE id = $1 AND result = 'pending'`,
    [id, result, failureCategory ?? null],
  );
}

export function createPostgresAdminSmtpConfigService(
  pool: DbPool,
  options: AdminSmtpConfigServiceOptions,
): AdminSmtpConfigService {
  const verifyConnection = options.verifyConnection ?? verifySmtpConnection;
  const sendMessage = options.sendMessage ?? sendSmtpMessage;

  async function requireSession(context: AdminRequestContext) {
    return options.adminService.requirePermission(context, "smtp_config.write");
  }

  async function validateCandidate(raw: unknown) {
    let input: SmtpSettingsInput;
    try {
      input = validateSmtpSettingsInput(raw);
    } catch (error) {
      throw validationError(error);
    }
    const current = await readCurrent(pool);
    assertExpectedRevision(input, current);
    return {
      input,
      current,
      config: candidateConfig(input, current, options.keyring),
    };
  }

  function recordTestMetric(outcome: "success" | "failure", reason: string) {
    options.metrics?.increment("auth_email_delivery_total", 1, {
      operation: "test",
      outcome,
      reason,
      source: "managed",
    });
  }

  async function audit(
    session: AdminSession,
    context: AdminRequestContext,
    action: string,
    result: "success" | "failure",
    after: Record<string, unknown>,
  ) {
    await withTransaction(pool, (client) =>
      insertAdminAuditEvent(
        client,
        {
          actor: session.admin,
          action,
          targetType: "smtp_configuration",
          targetId: "global",
          result,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after,
        },
        options.auditSecret,
      ),
    );
  }

  return {
    async getCurrent(context) {
      await requireSession(context);
      return responseFromRow(await readCurrent(pool), options.fallbackConfig);
    },

    async testConnection(raw, context) {
      const session = await requireSession(context);
      const attemptId = await reserveTestAttempt(pool, session, "connection");
      try {
        const { config } = await validateCandidate(raw);
        await verifyConnection(config);
        await completeTestAttempt(pool, attemptId, "success");
        recordTestMetric("success", "none");
        await audit(
          session,
          context,
          "admin.smtp.connection_tested",
          "success",
          {},
        );
        return { ok: true, testedAt: new Date().toISOString() };
      } catch (error) {
        const mapped =
          error instanceof AdminAccessError ? error : mapTransportError(error);
        const failureCategory =
          error instanceof SmtpTransportError ? error.category : "validation";
        await completeTestAttempt(pool, attemptId, "failure", failureCategory);
        recordTestMetric("failure", failureCategory);
        await audit(
          session,
          context,
          "admin.smtp.connection_tested",
          "failure",
          {},
        );
        throw mapped;
      }
    },

    async testEmail(raw, context) {
      const session = await requireSession(context);
      const attemptId = await reserveTestAttempt(pool, session, "email");
      try {
        let input: SmtpTestEmailInput;
        try {
          input = validateSmtpTestEmailInput(raw);
        } catch (error) {
          throw validationError(error);
        }
        const current = await readCurrent(pool);
        assertExpectedRevision(input, current);
        const config = candidateConfig(input, current, options.keyring);
        await sendMessage(config, {
          to: input.recipient,
          subject: "AI Canvas SMTP 测试邮件",
          text: "SMTP 配置验证成功。",
          html: "<p>SMTP 配置验证成功。</p>",
        });
        await completeTestAttempt(pool, attemptId, "success");
        recordTestMetric("success", "none");
        await audit(session, context, "admin.smtp.email_tested", "success", {});
        return { ok: true, testedAt: new Date().toISOString() };
      } catch (error) {
        const mapped =
          error instanceof AdminAccessError ? error : mapTransportError(error);
        const failureCategory =
          error instanceof SmtpTransportError ? error.category : "validation";
        await completeTestAttempt(pool, attemptId, "failure", failureCategory);
        recordTestMetric("failure", failureCategory);
        await audit(session, context, "admin.smtp.email_tested", "failure", {});
        throw mapped;
      }
    },

    async publish(raw, context) {
      const session = await requireSession(context);
      const { input, config } = await validateCandidate(raw);
      try {
        await verifyConnection(config);
      } catch (error) {
        throw mapTransportError(error);
      }
      const revisionId = randomUUID();
      const envelope = encryptSmtpPassword(
        config.password,
        revisionId,
        options.keyring,
      );
      return withTransaction(pool, async (client) => {
        const locked = await client.query<{ revision_id: string }>(
          `SELECT revision_id::text FROM admin.smtp_config_current
           WHERE singleton_id = 1 FOR UPDATE`,
        );
        const currentRevisionId = locked.rows[0]?.revision_id ?? null;
        if (currentRevisionId !== input.expectedRevisionId) {
          throw new AdminAccessError(
            409,
            "SMTP_CONFIG_CONFLICT",
            "SMTP configuration changed; reload and try again",
          );
        }
        await client.query(
          `INSERT INTO admin.smtp_config_revisions (
             id, enabled, host, port, security_mode, username,
             encrypted_password_json, key_version, from_email, from_name,
             created_by_admin_id
           ) VALUES ($1, true, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
          [
            revisionId,
            input.host,
            input.port,
            input.securityMode,
            input.username,
            JSON.stringify(envelope),
            envelope.keyVersion,
            input.fromEmail,
            input.fromName,
            session.admin.id,
          ],
        );
        await client.query(
          `INSERT INTO admin.smtp_config_current
             (singleton_id, revision_id, updated_by_admin_id)
           VALUES (1, $1, $2)
           ON CONFLICT (singleton_id) DO UPDATE SET
             revision_id = EXCLUDED.revision_id,
             updated_by_admin_id = EXCLUDED.updated_by_admin_id,
             updated_at = now()`,
          [revisionId, session.admin.id],
        );
        await client.query(
          `INSERT INTO public.smtp_config_publications (
             singleton_id, revision_id, enabled, host, port, security_mode,
             username, encrypted_password_json, key_version, from_email, from_name
           ) VALUES (1, $1, true, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
           ON CONFLICT (singleton_id) DO UPDATE SET
             revision_id = EXCLUDED.revision_id,
             enabled = EXCLUDED.enabled,
             host = EXCLUDED.host,
             port = EXCLUDED.port,
             security_mode = EXCLUDED.security_mode,
             username = EXCLUDED.username,
             encrypted_password_json = EXCLUDED.encrypted_password_json,
             key_version = EXCLUDED.key_version,
             from_email = EXCLUDED.from_email,
             from_name = EXCLUDED.from_name,
             published_at = now()`,
          [
            revisionId,
            input.host,
            input.port,
            input.securityMode,
            input.username,
            JSON.stringify(envelope),
            envelope.keyVersion,
            input.fromEmail,
            input.fromName,
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.smtp.published",
            targetType: "smtp_configuration",
            targetId: revisionId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              host: input.host,
              port: input.port,
              securityMode: input.securityMode,
              fromEmail: input.fromEmail,
              fromName: input.fromName,
              password: "[REDACTED]",
            },
          },
          options.auditSecret,
        );
        return responseFromRow(
          {
            revision_id: revisionId,
            enabled: true,
            host: input.host,
            port: input.port,
            security_mode: input.securityMode,
            username: input.username,
            encrypted_password_json: envelope,
            from_email: input.fromEmail,
            from_name: input.fromName,
            updated_at: new Date(),
          },
          options.fallbackConfig,
        );
      });
    },

    async disable(raw, context) {
      const session = await requireSession(context);
      let input: DisableSmtpSettingsInput;
      try {
        input = validateDisableSmtpSettingsInput(raw);
      } catch (error) {
        throw validationError(error);
      }
      const current = await readCurrent(pool);
      if (!current || current.revision_id !== input.expectedRevisionId) {
        throw new AdminAccessError(
          409,
          "SMTP_CONFIG_CONFLICT",
          "SMTP configuration changed; reload and try again",
        );
      }
      const password = decryptSmtpPassword(
        current.encrypted_password_json,
        current.revision_id,
        options.keyring,
      );
      const revisionId = randomUUID();
      const envelope = encryptSmtpPassword(
        password,
        revisionId,
        options.keyring,
      );
      return withTransaction(pool, async (client) => {
        const locked = await client.query<{ revision_id: string }>(
          `SELECT revision_id::text FROM admin.smtp_config_current
           WHERE singleton_id = 1 FOR UPDATE`,
        );
        if (locked.rows[0]?.revision_id !== input.expectedRevisionId) {
          throw new AdminAccessError(
            409,
            "SMTP_CONFIG_CONFLICT",
            "SMTP configuration changed; reload and try again",
          );
        }
        await client.query(
          `INSERT INTO admin.smtp_config_revisions (
             id, enabled, host, port, security_mode, username,
             encrypted_password_json, key_version, from_email, from_name,
             created_by_admin_id
           ) VALUES ($1, false, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
          [
            revisionId,
            current.host,
            current.port,
            current.security_mode,
            current.username,
            JSON.stringify(envelope),
            envelope.keyVersion,
            current.from_email,
            current.from_name,
            session.admin.id,
          ],
        );
        await client.query(
          `UPDATE admin.smtp_config_current SET revision_id = $1,
             updated_by_admin_id = $2, updated_at = now()
           WHERE singleton_id = 1`,
          [revisionId, session.admin.id],
        );
        await client.query(
          `UPDATE public.smtp_config_publications SET revision_id = $1,
             enabled = false, encrypted_password_json = $2::jsonb,
             key_version = $3, published_at = now()
           WHERE singleton_id = 1`,
          [revisionId, JSON.stringify(envelope), envelope.keyVersion],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.smtp.disabled",
            targetType: "smtp_configuration",
            targetId: revisionId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          options.auditSecret,
        );
        return responseFromRow(
          {
            ...current,
            revision_id: revisionId,
            enabled: false,
            encrypted_password_json: envelope,
            updated_at: new Date(),
          },
          options.fallbackConfig,
        );
      });
    },
  };
}

export function createUnavailableAdminSmtpConfigService(): AdminSmtpConfigService {
  const unavailable = async (): Promise<never> => {
    throw new AdminAccessError(
      503,
      "SERVICE_UNAVAILABLE",
      "SMTP configuration service is unavailable",
    );
  };
  return {
    getCurrent: unavailable,
    testConnection: unavailable,
    testEmail: unavailable,
    publish: unavailable,
    disable: unavailable,
  };
}
