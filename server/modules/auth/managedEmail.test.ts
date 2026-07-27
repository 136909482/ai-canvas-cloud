import assert from "node:assert/strict";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import type { DbPool } from "../../dist/db/postgres.js";
import { createManagedSmtpAuthEmailService } from "../../dist/modules/auth/email.js";
import {
  createSmtpCredentialKeyring,
  encryptSmtpPassword,
  type SmtpRuntimeConfig,
} from "../../dist/modules/mail/smtp.js";

const keyring = createSmtpCredentialKeyring({
  developmentSecret: "managed-email-test-secret",
});
const fallback: SmtpRuntimeConfig = {
  revisionId: "environment",
  host: "smtp.example.com",
  port: 465,
  securityMode: "implicit_tls",
  username: "environment@example.com",
  password: "environment-password",
  fromEmail: "noreply@example.com",
  fromName: "AI Canvas",
  source: "environment",
};

test("managed auth email resolves revisions dynamically and falls back only before publication", async () => {
  let row: Record<string, unknown> | undefined;
  const pool = {
    async query() {
      return { rows: row ? [row] : [] };
    },
  } as unknown as DbPool;
  const sent: SmtpRuntimeConfig[] = [];
  const metrics = createMetricsRegistry();
  const service = createManagedSmtpAuthEmailService(pool, {
    keyring,
    fallbackConfig: fallback,
    metrics,
    async sendMessage(config) {
      sent.push(config);
    },
  });

  await service.sendRegistrationEmailCode({
    to: "user@example.com",
    code: "123456",
    expiresInSeconds: 3600,
  });
  assert.equal(sent[0]?.source, "environment");

  const revisionId = "123e4567-e89b-42d3-a456-426614174000";
  row = {
    revision_id: revisionId,
    enabled: true,
    host: "smtp.managed.example",
    port: 587,
    security_mode: "starttls",
    username: "managed@example.com",
    encrypted_password_json: encryptSmtpPassword(
      "managed-password",
      revisionId,
      keyring,
    ),
    from_email: "managed@example.com",
    from_name: "Managed Mail",
  };
  await service.sendPasswordResetEmail({
    to: "user@example.com",
    code: "654321",
    expiresInSeconds: 3600,
  });
  assert.equal(sent[1]?.source, "managed");
  assert.equal(sent[1]?.password, "managed-password");

  row = { ...row, enabled: false };
  await assert.rejects(
    () =>
      service.sendRegistrationEmailCode({
        to: "user@example.com",
        code: "123456",
        expiresInSeconds: 3600,
      }),
    /unavailable/,
  );
  const rendered = metrics.renderPrometheus();
  assert.match(rendered, /auth_email_delivery_total/);
  assert.doesNotMatch(rendered, /user@example|654321|managed-password/);
});
