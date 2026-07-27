import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
import type { DbPool } from "../../db/postgres.js";
import type { AuthEmailService } from "./email.js";
import { AuthServiceError } from "./service.js";

const CODE_LENGTH = 6;
export const PASSWORD_RESET_CODE_EXPIRES_IN_SECONDS = 10 * 60;
export const PASSWORD_RESET_CODE_RESEND_COOLDOWN_SECONDS = 60;
const MAX_FAILED_ATTEMPTS = 5;
const TOKEN_IV_LENGTH = 12;
const TOKEN_AUTH_TAG_LENGTH = 16;
const TOKEN_AAD = Buffer.from("ai-canvas-cloud/password-reset-token/v1");

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
    apiCode: "VALIDATION_FAILED",
    message: "Password reset code is invalid or expired",
  });
}

export interface PasswordResetEmailCodeService {
  isCoolingDown: (email: string) => Promise<boolean>;
  send: (email: string, resetToken: string) => Promise<void>;
  consume: (email: string, code: string) => Promise<string>;
}

export function createPasswordResetEmailCodeService(
  pool: DbPool,
  options: { secret: string; emailService: AuthEmailService },
) {
  const emailHash = (email: string) =>
    keyedHash(options.secret, "password-reset-email", email);
  const codeHash = (hashedEmail: string, code: string) =>
    keyedHash(
      options.secret,
      "password-reset-email-code",
      `${hashedEmail}\0${code}`,
    );
  const tokenKey = createHmac("sha256", options.secret)
    .update("password-reset-token-encryption/v1")
    .digest();

  const encryptToken = (token: string) => {
    const initializationVector = randomBytes(TOKEN_IV_LENGTH);
    const cipher = createCipheriv(
      "aes-256-gcm",
      tokenKey,
      initializationVector,
    );
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([
      initializationVector,
      cipher.getAuthTag(),
      ciphertext,
    ]).toString("base64url");
  };

  const decryptToken = (ciphertext: string) => {
    try {
      const encrypted = Buffer.from(ciphertext, "base64url");
      if (encrypted.length <= TOKEN_IV_LENGTH + TOKEN_AUTH_TAG_LENGTH) {
        throw new Error("Invalid encrypted reset token");
      }
      const initializationVector = encrypted.subarray(0, TOKEN_IV_LENGTH);
      const authTag = encrypted.subarray(
        TOKEN_IV_LENGTH,
        TOKEN_IV_LENGTH + TOKEN_AUTH_TAG_LENGTH,
      );
      const payload = encrypted.subarray(
        TOKEN_IV_LENGTH + TOKEN_AUTH_TAG_LENGTH,
      );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        tokenKey,
        initializationVector,
      );
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(payload),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw invalidCodeError();
    }
  };

  return {
    async isCoolingDown(email: string) {
      const result = await pool.query<{ cooling_down: boolean }>(
        `
          SELECT last_sent_at > now() - ($2::integer * interval '1 second')
            AS cooling_down
          FROM password_reset_email_challenges
          WHERE email_hash = $1
            AND consumed_at IS NULL
            AND expires_at > now()
          LIMIT 1
        `,
        [emailHash(email), PASSWORD_RESET_CODE_RESEND_COOLDOWN_SECONDS],
      );
      return result.rows[0]?.cooling_down === true;
    },

    async send(email: string, resetToken: string) {
      const hashedEmail = emailHash(email);
      const code = createCode();
      const hashedCode = codeHash(hashedEmail, code);
      const encryptedToken = encryptToken(resetToken);
      const issued = await pool.query<{ expires_at: Date | string }>(
        `
          INSERT INTO password_reset_email_challenges (
            email_hash, code_hash, reset_token_ciphertext, expires_at,
            last_sent_at, failed_attempts, consumed_at, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, now() + ($4::integer * interval '1 second'),
            now(), 0, NULL, now(), now()
          )
          ON CONFLICT (email_hash) DO UPDATE
          SET code_hash = EXCLUDED.code_hash,
              reset_token_ciphertext = EXCLUDED.reset_token_ciphertext,
              expires_at = EXCLUDED.expires_at,
              last_sent_at = EXCLUDED.last_sent_at,
              failed_attempts = 0,
              consumed_at = NULL,
              updated_at = now()
          WHERE password_reset_email_challenges.last_sent_at <=
            now() - ($5::integer * interval '1 second')
          RETURNING expires_at
        `,
        [
          hashedEmail,
          hashedCode,
          encryptedToken,
          PASSWORD_RESET_CODE_EXPIRES_IN_SECONDS,
          PASSWORD_RESET_CODE_RESEND_COOLDOWN_SECONDS,
        ],
      );
      if (issued.rows.length === 0) return;

      try {
        await options.emailService.sendPasswordResetEmail({
          to: email,
          code,
          expiresInSeconds: PASSWORD_RESET_CODE_EXPIRES_IN_SECONDS,
        });
      } catch {
        await pool
          .query(
            `
              DELETE FROM password_reset_email_challenges
              WHERE email_hash = $1
                AND code_hash = $2
                AND reset_token_ciphertext = $3
            `,
            [hashedEmail, hashedCode, encryptedToken],
          )
          .catch(() => undefined);
        throw new AuthServiceError({
          statusCode: 503,
          apiCode: "SERVICE_UNAVAILABLE",
          message: "Unable to send the password reset email code",
          retryable: true,
        });
      }
    },

    async consume(email: string, code: string) {
      if (!/^\d{6}$/.test(code)) throw invalidCodeError();

      const hashedEmail = emailHash(email);
      const consumed = await pool.query<{ reset_token_ciphertext: string }>(
        `
          UPDATE password_reset_email_challenges
          SET consumed_at = now(), updated_at = now()
          WHERE email_hash = $1
            AND code_hash = $2
            AND consumed_at IS NULL
            AND expires_at > now()
            AND failed_attempts < $3
          RETURNING reset_token_ciphertext
        `,
        [hashedEmail, codeHash(hashedEmail, code), MAX_FAILED_ATTEMPTS],
      );
      const ciphertext = consumed.rows[0]?.reset_token_ciphertext;
      if (ciphertext) return decryptToken(ciphertext);

      await pool.query(
        `
          UPDATE password_reset_email_challenges
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
  } satisfies PasswordResetEmailCodeService;
}
