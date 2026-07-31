import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";
import type { DbPool } from "../../db/postgres.js";
import {
  decryptSmtpPassword,
  createRevisionCachedSmtpSender,
  sendSmtpMessage,
  SmtpTransportError,
  type SmtpCredentialEnvelope,
  type SmtpCredentialKeyring,
  type SmtpRuntimeConfig,
} from "../mail/smtp.js";

export interface RegistrationEmailCodeInput {
  to: string;
  code: string;
  expiresInSeconds: number;
}

export interface PasswordResetEmailInput {
  to: string;
  code: string;
  expiresInSeconds: number;
}

export interface AuthEmailService {
  sendRegistrationEmailCode: (
    input: RegistrationEmailCodeInput,
  ) => Promise<void>;
  sendPasswordResetEmail: (input: PasswordResetEmailInput) => Promise<void>;
}

export function createFailureTolerantAuthEmailService(
  service: AuthEmailService,
): AuthEmailService {
  async function deliver(send: () => Promise<void>) {
    try {
      await send();
    } catch {
      // Authentication responses must not reveal recipient or provider state.
    }
  }
  return {
    sendRegistrationEmailCode(input) {
      return deliver(() => service.sendRegistrationEmailCode(input));
    },
    sendPasswordResetEmail(input) {
      return deliver(() => service.sendPasswordResetEmail(input));
    },
  };
}

interface ManagedSmtpRow {
  revision_id: string;
  enabled: boolean;
  host: string;
  port: number;
  security_mode: "implicit_tls" | "starttls";
  username: string;
  encrypted_password_json: SmtpCredentialEnvelope;
  from_email: string;
  from_name: string;
}

export class AuthEmailDeliveryError extends Error {
  readonly category: string;

  constructor(category: string) {
    super("Authentication email delivery is unavailable");
    this.name = "AuthEmailDeliveryError";
    this.category = category;
  }
}

export function createManagedSmtpAuthEmailService(
  pool: DbPool,
  options: {
    keyring: SmtpCredentialKeyring;
    metrics?: MetricsRegistry;
    sendMessage?: typeof sendSmtpMessage;
  },
): AuthEmailService {
  let cached: SmtpRuntimeConfig | null = null;
  const cachedSender = options.sendMessage
    ? null
    : createRevisionCachedSmtpSender();

  async function currentConfig() {
    const result = await pool.query<ManagedSmtpRow>(`
      SELECT revision_id::text, enabled, host, port, security_mode, username,
             encrypted_password_json, from_email, from_name
      FROM public.smtp_config_publications
      WHERE singleton_id = 1
    `);
    const row = result.rows[0];
    if (!row) throw new AuthEmailDeliveryError("not_configured");
    if (!row.enabled) throw new AuthEmailDeliveryError("disabled");
    if (cached?.revisionId === row.revision_id) return cached;
    cached = {
      revisionId: row.revision_id,
      host: row.host,
      port: row.port,
      securityMode: row.security_mode,
      username: row.username,
      password: decryptSmtpPassword(
        row.encrypted_password_json,
        row.revision_id,
        options.keyring,
      ),
      fromEmail: row.from_email,
      fromName: row.from_name,
      source: "managed",
    };
    return cached;
  }

  async function send(
    operation: "registration_code" | "password_reset",
    input: RegistrationEmailCodeInput | PasswordResetEmailInput,
  ) {
    const source = "managed";
    try {
      const config = await currentConfig();
      const minutes = Math.round(input.expiresInSeconds / 60);
      const isRegistrationCode = operation === "registration_code";
      const text = isRegistrationCode
        ? `Your AI Canvas registration code is: ${(input as RegistrationEmailCodeInput).code}\nThis code expires in ${minutes} minutes.`
        : `Your AI Canvas password reset code is: ${(input as PasswordResetEmailInput).code}\nThis code expires in ${minutes} minutes.`;
      const html = isRegistrationCode
        ? `<p>Your AI Canvas registration code is:</p><p><strong style="font-size:24px;letter-spacing:4px">${(input as RegistrationEmailCodeInput).code}</strong></p><p>This code expires in ${minutes} minutes.</p>`
        : `<p>Your AI Canvas password reset code is:</p><p><strong style="font-size:24px;letter-spacing:4px">${(input as PasswordResetEmailInput).code}</strong></p><p>This code expires in ${minutes} minutes.</p>`;
      await (options.sendMessage ?? cachedSender!.send)(config, {
        to: input.to,
        subject: isRegistrationCode
          ? "AI Canvas registration email code"
          : "Reset your AI Canvas password",
        text,
        html,
      });
      options.metrics?.increment("auth_email_delivery_total", 1, {
        operation,
        outcome: "success",
        reason: "none",
        source,
      });
    } catch (error) {
      const category =
        error instanceof SmtpTransportError
          ? error.category
          : error instanceof AuthEmailDeliveryError
            ? error.category
            : "internal";
      options.metrics?.increment("auth_email_delivery_total", 1, {
        operation,
        outcome: "failure",
        reason: category,
        source,
      });
      throw error instanceof AuthEmailDeliveryError
        ? error
        : new AuthEmailDeliveryError(category);
    }
  }

  return {
    sendRegistrationEmailCode(input) {
      return send("registration_code", input);
    },
    sendPasswordResetEmail(input) {
      return send("password_reset", input);
    },
  };
}

export function createDevelopmentAuthEmailService(options: {
  env: string;
  logger: Logger;
}): AuthEmailService {
  return {
    async sendRegistrationEmailCode(input) {
      if (options.env === "production") {
        options.logger.error("auth.email.registration_code.not_configured", {
          expiresInSeconds: input.expiresInSeconds,
        });
        throw new Error("Production email service is not configured");
      }

      options.logger.info("auth.email.registration_code.dev_suppressed", {
        delivery: "suppressed",
        expiresInSeconds: input.expiresInSeconds,
      });
    },
    async sendPasswordResetEmail(input) {
      if (options.env === "production") {
        options.logger.error("auth.email.password_reset.not_configured", {
          expiresInSeconds: input.expiresInSeconds,
        });
        throw new Error("Production email service is not configured");
      }

      options.logger.info("auth.email.password_reset.dev_suppressed", {
        delivery: "suppressed",
        expiresInSeconds: input.expiresInSeconds,
      });
    },
  };
}
