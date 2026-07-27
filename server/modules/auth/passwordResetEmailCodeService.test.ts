import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../dist/db/postgres.js";
import { createPasswordResetEmailCodeService } from "../../dist/modules/auth/passwordResetEmailCodeService.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";

test("password reset challenges hash email and code while encrypting the Better Auth token", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let sentCode = "";
  let encryptedToken = "";
  const resetToken = "better-auth-reset-token-fixture";
  const pool = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO password_reset_email_challenges")) {
        encryptedToken = String(values?.[2]);
        return { rows: [{ expires_at: new Date() }] };
      }
      if (text.includes("SET consumed_at = now()")) {
        return { rows: [{ reset_token_ciphertext: encryptedToken }] };
      }
      return { rows: [] };
    },
  } as unknown as DbPool;
  const service = createPasswordResetEmailCodeService(pool, {
    secret: "password-reset-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode() {},
      async sendPasswordResetEmail(input) {
        sentCode = input.code;
      },
    },
  });

  await service.send("artist@example.com", resetToken);
  assert.match(sentCode, /^\d{6}$/);
  assert.notEqual(encryptedToken, resetToken);
  assert.equal(
    await service.consume("artist@example.com", sentCode),
    resetToken,
  );

  const challengeWrite = calls.find((call) =>
    call.text.includes("INSERT INTO password_reset_email_challenges"),
  );
  const serialized = JSON.stringify(challengeWrite?.values);
  assert.equal(serialized.includes("artist@example.com"), false);
  assert.equal(serialized.includes(sentCode), false);
  assert.equal(serialized.includes(resetToken), false);
});

test("password reset challenge cooldown prevents a replacement token", async () => {
  let delivered = false;
  const pool = {
    async query(text: string) {
      if (text.includes("INSERT INTO password_reset_email_challenges")) {
        return { rows: [] };
      }
      if (text.includes("AS cooling_down")) {
        return { rows: [{ cooling_down: true }] };
      }
      return { rows: [] };
    },
  } as unknown as DbPool;
  const service = createPasswordResetEmailCodeService(pool, {
    secret: "password-reset-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode() {},
      async sendPasswordResetEmail() {
        delivered = true;
      },
    },
  });

  assert.equal(await service.isCoolingDown("artist@example.com"), true);
  await service.send("artist@example.com", "new-better-auth-token");
  assert.equal(delivered, false);
});

test("invalid password reset email codes consume attempts without exposing state", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  } as unknown as DbPool;
  const service = createPasswordResetEmailCodeService(pool, {
    secret: "password-reset-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode() {},
      async sendPasswordResetEmail() {},
    },
  });

  await assert.rejects(
    () => service.consume("artist@example.com", "000000"),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.apiCode === "VALIDATION_FAILED",
  );
});
