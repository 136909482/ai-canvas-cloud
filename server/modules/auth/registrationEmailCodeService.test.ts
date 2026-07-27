import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../dist/db/postgres.js";
import { createRegistrationEmailCodeService } from "../../dist/modules/auth/registrationEmailCodeService.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";

test("registration email challenges store only keyed hashes", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let sentCode = "";
  const pool = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM "user"')) return { rows: [] };
      if (text.includes("INSERT INTO registration_email_challenges")) {
        return { rows: [{ expires_at: new Date() }] };
      }
      if (text.includes("SET consumed_at = now()")) {
        return { rows: [{ email_hash: "a".repeat(64) }] };
      }
      return { rows: [] };
    },
  } as unknown as DbPool;
  const service = createRegistrationEmailCodeService(pool, {
    secret: "registration-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode(input) {
        sentCode = input.code;
      },
      async sendPasswordResetEmail() {},
    },
  });

  const result = await service.send("artist@example.com");
  assert.deepEqual(result, { ok: true, resendAfterSeconds: 60 });
  assert.match(sentCode, /^\d{6}$/);
  await service.consume("artist@example.com", sentCode);

  const challengeWrite = calls.find((call) =>
    call.text.includes("INSERT INTO registration_email_challenges"),
  );
  const serialized = JSON.stringify(challengeWrite?.values);
  assert.equal(serialized.includes("artist@example.com"), false);
  assert.equal(serialized.includes(sentCode), false);
});

test("registered emails receive the same cooldown response without delivery", async () => {
  let delivered = false;
  const pool = {
    async query(text: string) {
      if (text.includes('SELECT id FROM "user"')) {
        return { rows: [{ id: "existing-user" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as DbPool;
  const service = createRegistrationEmailCodeService(pool, {
    secret: "registration-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode() {
        delivered = true;
      },
      async sendPasswordResetEmail() {},
    },
  });

  assert.deepEqual(await service.send("artist@example.com"), {
    ok: true,
    resendAfterSeconds: 60,
  });
  assert.equal(delivered, false);
});

test("invalid registration email codes consume attempts without exposing state", async () => {
  const pool = {
    async query(text: string) {
      if (text.includes("SET consumed_at = now()")) return { rows: [] };
      return { rows: [] };
    },
  } as unknown as DbPool;
  const service = createRegistrationEmailCodeService(pool, {
    secret: "registration-email-code-test-secret",
    emailService: {
      async sendRegistrationEmailCode() {},
      async sendPasswordResetEmail() {},
    },
  });

  await assert.rejects(
    () => service.consume("artist@example.com", "000000"),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.apiCode === "EMAIL_NOT_VERIFIED",
  );
});
