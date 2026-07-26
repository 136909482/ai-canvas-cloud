import assert from "node:assert/strict";
import test from "node:test";
import type { Logger } from "@ai-canvas-cloud/shared";
import {
  createDevelopmentAuthEmailService,
  createFailureTolerantAuthEmailService,
} from "../../dist/modules/auth/email.js";

test("authentication email delivery failures do not escape into auth responses", async () => {
  const calls: string[] = [];
  const service = createFailureTolerantAuthEmailService({
    async sendVerificationEmail() {
      calls.push("verification");
      throw new Error("provider unavailable");
    },
    async sendPasswordResetEmail() {
      calls.push("password_reset");
      throw new Error("provider unavailable");
    },
  });
  await service.sendVerificationEmail({
    to: "fixture@example.invalid",
    verificationUrl: "https://web.invalid/verify?token=secret",
    expiresInSeconds: 900,
  });
  await service.sendPasswordResetEmail({
    to: "fixture@example.invalid",
    resetUrl: "https://web.invalid/reset?token=secret",
    expiresInSeconds: 900,
  });
  assert.deepEqual(calls, ["verification", "password_reset"]);
});

test("development email diagnostics never expose verification or reset tokens", async () => {
  const entries: Array<{ message: string; context?: Record<string, unknown> }> =
    [];
  const logger: Logger = {
    debug() {},
    info(message, context) {
      entries.push({ message, context });
    },
    warn() {},
    error() {},
  };
  const service = createDevelopmentAuthEmailService({
    env: "development",
    logger,
  });
  const verificationToken = "verification-fixture-secret";
  const resetToken = "reset-fixture-secret";

  await service.sendVerificationEmail({
    to: "fixture@example.invalid",
    verificationUrl: `https://web.invalid/auth/verify-email?token=${verificationToken}`,
    expiresInSeconds: 900,
  });
  await service.sendPasswordResetEmail({
    to: "fixture@example.invalid",
    resetUrl: `https://web.invalid/auth/reset-password?token=${resetToken}`,
    expiresInSeconds: 900,
  });

  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes(verificationToken), false);
  assert.equal(serialized.includes(resetToken), false);
  assert.equal(serialized.includes("fixture@example.invalid"), false);
  assert.equal(serialized.includes("/auth/"), false);
  assert.deepEqual(
    entries.map((entry) => entry.context?.delivery),
    ["suppressed", "suppressed"],
  );
});
