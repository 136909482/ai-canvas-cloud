import type { Logger } from "@ai-canvas-cloud/shared";
import type { MetricsRegistry } from "@ai-canvas-cloud/shared";
import nodemailer from "nodemailer";
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

export interface VerificationEmailInput {
  to: string;
  verificationUrl: string;
  expiresInSeconds: number;
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
  expiresInSeconds: number;
}

export interface AuthEmailService {
  sendVerificationEmail: (input: VerificationEmailInput) => Promise<void>;
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
    sendVerificationEmail(input) {
      return deliver(() => service.sendVerificationEmail(input));
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
    fallbackConfig?: SmtpRuntimeConfig;
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
    if (!row) {
      if (options.fallbackConfig) return options.fallbackConfig;
      throw new AuthEmailDeliveryError("not_configured");
    }
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
    kind: "verification" | "password_reset",
    input: { to: string; url: string; expiresInSeconds: number },
  ) {
    let source: "managed" | "environment" = "managed";
    try {
      const config = await currentConfig();
      source = config.source;
      const minutes = Math.round(input.expiresInSeconds / 60);
      const verification = kind === "verification";
      await (options.sendMessage ?? cachedSender!.send)(config, {
        to: input.to,
        subject: verification
          ? "验证你的 AI Canvas 邮箱"
          : "重置你的 AI Canvas 密码",
        text: `${verification ? "验证邮箱" : "重置密码"}：${input.url}\n链接将在 ${minutes} 分钟后失效。`,
        html: `<p>${verification ? "请验证你的邮箱" : "请重置你的密码"}：</p><p><a href="${input.url}">${verification ? "验证邮箱" : "重置密码"}</a></p><p>链接将在 ${minutes} 分钟后失效。</p>`,
      });
      options.metrics?.increment("auth_email_delivery_total", 1, {
        operation: kind,
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
        operation: kind,
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
    sendVerificationEmail(input) {
      return send("verification", {
        to: input.to,
        url: input.verificationUrl,
        expiresInSeconds: input.expiresInSeconds,
      });
    },
    sendPasswordResetEmail(input) {
      return send("password_reset", {
        to: input.to,
        url: input.resetUrl,
        expiresInSeconds: input.expiresInSeconds,
      });
    },
  };
}

export function createSmtpAuthEmailService(options: {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  password: string;
}): AuthEmailService {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.username, pass: options.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendVerificationEmail(input) {
      await transporter.sendMail({
        from: options.from,
        to: input.to,
        subject: "Verify your AI Canvas Cloud email",
        text: `Verify your email: ${input.verificationUrl}\nThis link expires in ${Math.round(input.expiresInSeconds / 60)} minutes.`,
      });
    },
    async sendPasswordResetEmail(input) {
      await transporter.sendMail({
        from: options.from,
        to: input.to,
        subject: "Reset your AI Canvas Cloud password",
        text: `Reset your password: ${input.resetUrl}\nThis link expires in ${Math.round(input.expiresInSeconds / 60)} minutes.`,
      });
    },
  };
}

export function createDevelopmentAuthEmailService(options: {
  env: string;
  logger: Logger;
}): AuthEmailService {
  return {
    async sendVerificationEmail(input) {
      if (options.env === "production") {
        options.logger.error("auth.email.verification.not_configured", {
          expiresInSeconds: input.expiresInSeconds,
        });
        throw new Error("Production email service is not configured");
      }

      options.logger.info("auth.email.verification.dev_link", {
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

      options.logger.info("auth.email.password_reset.dev_link", {
        delivery: "suppressed",
        expiresInSeconds: input.expiresInSeconds,
      });
    },
  };
}
