import { createHmac, randomInt } from "node:crypto";
import type { DbPool } from "../../db/postgres.js";
import type { AuthEmailService } from "./email.js";
import { AuthServiceError } from "./service.js";

const CODE_LENGTH = 6;
const CODE_EXPIRES_IN_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_FAILED_ATTEMPTS = 5;

export interface RegistrationEmailCodeResult {
  ok: true;
  resendAfterSeconds: number;
}

function keyedHash(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret)
    .update(purpose)
    .update("\0")
    .update(value)
    .digest("hex");
}

function createCode() {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

function invalidCodeError() {
  return new AuthServiceError({
    statusCode: 400,
    apiCode: "EMAIL_NOT_VERIFIED",
    message: "Email verification code is invalid or expired",
  });
}

export function createRegistrationEmailCodeService(
  pool: DbPool,
  options: { secret: string; emailService: AuthEmailService },
) {
  const emailHash = (email: string) =>
    keyedHash(options.secret, "registration-email", email);
  const codeHash = (hashedEmail: string, code: string) =>
    keyedHash(
      options.secret,
      "registration-email-code",
      `${hashedEmail}\0${code}`,
    );

  return {
    async send(email: string): Promise<RegistrationEmailCodeResult> {
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
        [email],
      );
      if (existing.rows.length > 0) {
        // Keep the response indistinguishable from a newly issued challenge.
        return { ok: true, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
      }

      const hashedEmail = emailHash(email);
      const code = createCode();
      const hashedCode = codeHash(hashedEmail, code);
      const issued = await pool.query<{ expires_at: Date | string }>(
        `
          INSERT INTO registration_email_challenges (
            email_hash, code_hash, expires_at, last_sent_at,
            failed_attempts, consumed_at, created_at, updated_at
          )
          VALUES (
            $1, $2, now() + ($3::integer * interval '1 second'), now(),
            0, NULL, now(), now()
          )
          ON CONFLICT (email_hash) DO UPDATE
          SET code_hash = EXCLUDED.code_hash,
              expires_at = EXCLUDED.expires_at,
              last_sent_at = EXCLUDED.last_sent_at,
              failed_attempts = 0,
              consumed_at = NULL,
              updated_at = now()
          WHERE registration_email_challenges.last_sent_at <=
            now() - ($4::integer * interval '1 second')
          RETURNING expires_at
        `,
        [
          hashedEmail,
          hashedCode,
          CODE_EXPIRES_IN_SECONDS,
          RESEND_COOLDOWN_SECONDS,
        ],
      );
      if (issued.rows.length === 0) {
        const cooldown = await pool.query<{ resend_after_seconds: number }>(
          `
            SELECT GREATEST(
              0,
              CEIL(EXTRACT(EPOCH FROM (
                last_sent_at + ($2::integer * interval '1 second') - now()
              )))
            )::integer AS resend_after_seconds
            FROM registration_email_challenges
            WHERE email_hash = $1
          `,
          [hashedEmail, RESEND_COOLDOWN_SECONDS],
        );
        return {
          ok: true,
          resendAfterSeconds:
            cooldown.rows[0]?.resend_after_seconds ?? RESEND_COOLDOWN_SECONDS,
        };
      }

      try {
        await options.emailService.sendRegistrationEmailCode({
          to: email,
          code,
          expiresInSeconds: CODE_EXPIRES_IN_SECONDS,
        });
      } catch {
        await pool
          .query(
            `
              DELETE FROM registration_email_challenges
              WHERE email_hash = $1 AND code_hash = $2
            `,
            [hashedEmail, hashedCode],
          )
          .catch(() => undefined);
        throw new AuthServiceError({
          statusCode: 503,
          apiCode: "SERVICE_UNAVAILABLE",
          message: "Unable to send the registration email code",
          retryable: true,
        });
      }

      return { ok: true, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
    },

    async consume(email: string, code: string) {
      if (!/^\d{6}$/.test(code)) throw invalidCodeError();

      const hashedEmail = emailHash(email);
      const consumed = await pool.query<{ email_hash: string }>(
        `
          UPDATE registration_email_challenges
          SET consumed_at = now(), updated_at = now()
          WHERE email_hash = $1
            AND code_hash = $2
            AND consumed_at IS NULL
            AND expires_at > now()
            AND failed_attempts < $3
          RETURNING email_hash
        `,
        [hashedEmail, codeHash(hashedEmail, code), MAX_FAILED_ATTEMPTS],
      );
      if (consumed.rows.length > 0) return;

      await pool.query(
        `
          UPDATE registration_email_challenges
          SET failed_attempts = failed_attempts + 1,
              consumed_at = CASE
                WHEN failed_attempts + 1 >= $2 THEN now()
                ELSE consumed_at
              END,
              updated_at = now()
          WHERE email_hash = $1
            AND consumed_at IS NULL
            AND expires_at > now()
            AND failed_attempts < $2
        `,
        [hashedEmail, MAX_FAILED_ATTEMPTS],
      );
      throw invalidCodeError();
    },
  };
}
