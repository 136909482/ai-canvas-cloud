import type { Logger } from "@ai-canvas-cloud/shared";
import type { DbPool } from "../../db/postgres.js";
import {
  AuthServiceError,
  normalizeEmail,
  validatePassword,
  type AuthService,
} from "./service.js";

export interface DevelopmentAdminSeedOptions {
  enabled: boolean;
  env: string;
  email: string;
  password?: string;
  authService: AuthService;
  pool: DbPool;
  logger: Logger;
}

export async function seedDevelopmentAdminAccount(
  options: DevelopmentAdminSeedOptions,
) {
  if (!options.enabled) {
    return;
  }

  let email: string;

  try {
    email = normalizeEmail(options.email);
  } catch (error) {
    options.logger.warn("auth.dev_admin_seed.invalid_email", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (options.env === "production") {
    options.logger.warn("auth.dev_admin_seed.disabled_in_production", {
      email,
    });
    return;
  }

  if (!options.password) {
    options.logger.warn("auth.dev_admin_seed.missing_password", { email });
    return;
  }

  try {
    validatePassword(options.password);
  } catch (error) {
    options.logger.warn("auth.dev_admin_seed.invalid_password", {
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let created = false;

  try {
    await options.authService.register(
      {
        email,
        password: options.password,
      },
      {
        requestId: "dev_admin_seed",
        userAgent: "ai-canvas-cloud-dev-seed",
      },
    );
    created = true;
  } catch (error) {
    if (!(error instanceof AuthServiceError && error.statusCode === 409)) {
      options.logger.warn("auth.dev_admin_seed.failed", {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  try {
    const updateResult = await options.pool.query(
      `
      UPDATE "user"
      SET email_verified = TRUE,
          status = COALESCE(status, 'active'),
          updated_at = now()
      WHERE lower(email) = lower($1)
    `,
      [email],
    );

    if (!updateResult.rowCount) {
      options.logger.warn("auth.dev_admin_seed.failed", {
        email,
        error: "Local admin account was not found after registration",
      });
      return;
    }

    options.logger.info("auth.dev_admin_seed.ready", { email, created });
  } catch (error) {
    options.logger.warn("auth.dev_admin_seed.failed", {
      email,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
