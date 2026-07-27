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
    async sendRegistrationEmailCode() {
      calls.push("registration_code");
      throw new Error("provider unavailable");
    },
    async sendPasswordResetEmail() {
      calls.push("password_reset");
      throw new Error("provider unavailable");
    },
  });
  await service.sendRegistrationEmailCode({
    to: "fixture@example.invalid",
    code: "123456",
    expiresInSeconds: 900,
  });
  await service.sendPasswordResetEmail({
    to: "fixture@example.invalid",
    code: "654321",
    expiresInSeconds: 900,
  });
  assert.deepEqual(calls, ["registration_code", "password_reset"]);
});

test("development email diagnostics never expose email verification codes", async () => {
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
  const registrationCode = "123456";
  const resetCode = "654321";

  await service.sendRegistrationEmailCode({
    to: "fixture@example.invalid",
    code: registrationCode,
    expiresInSeconds: 900,
  });
  await service.sendPasswordResetEmail({
    to: "fixture@example.invalid",
    code: resetCode,
    expiresInSeconds: 900,
  });

  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes(registrationCode), false);
  assert.equal(serialized.includes(resetCode), false);
  assert.equal(serialized.includes("fixture@example.invalid"), false);
  assert.equal(serialized.includes("/auth/"), false);
  assert.deepEqual(
    entries.map((entry) => entry.context?.delivery),
    ["suppressed", "suppressed"],
  );
});
