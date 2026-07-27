import { betterAuth, APIError } from "better-auth";
import { splitSetCookieHeader } from "better-auth/cookies";
import { username } from "better-auth/plugins";
import type {
  AuthDevicesResponse,
  AuthSessionResponse,
  AuthSessionsResponse,
  AuthSuccessResponse,
  DeviceSummary,
  LoginRequest,
  PasswordChangeRequest,
  PasswordChangeResponse,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  RegisterRequest,
  RegistrationEmailCodeRequest,
  RegistrationEmailCodeResponse,
  RemoveDeviceResponse,
  RevokeSessionResponse,
  SessionSummary,
  UserStatus,
  WorkspaceRole,
  WorkspaceStatus,
  WorkspaceType,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import {
  AuthServiceError,
  createPersonalWorkspaceName,
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeRegistrationInput,
  normalizeUsername,
  validatePassword,
  type AuthRequestContext,
  type AuthService,
  type RevokedAuthSession,
} from "./service.js";
import {
  createFailureTolerantAuthEmailService,
  type AuthEmailService,
} from "./email.js";
import {
  createPasswordResetEmailCodeService,
  PASSWORD_RESET_CODE_EXPIRES_IN_SECONDS,
  type PasswordResetEmailCodeService,
} from "./passwordResetEmailCodeService.js";
import { createRegistrationEmailCodeService } from "./registrationEmailCodeService.js";

export interface PostgresAuthServiceOptions {
  baseURL?: string;
  secret?: string;
  publicWebUrl?: string;
  environment?: string;
  trustedOrigins?: string[];
  emailService?: AuthEmailService;
  registrationEmailVerificationRequired?: () => Promise<boolean>;
  passwordResetEmailCodes?: PasswordResetEmailCodeService;
  authApi?: BetterAuthApi;
}

interface BetterAuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface BetterAuthSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface EndpointResult<T> {
  response: T;
  headers: Headers;
}

interface BetterAuthApi {
  signUpEmail: (input: {
    body: {
      email: string;
      password: string;
      name: string;
      username: string;
      displayUsername: string;
      rememberMe?: boolean;
    };
    headers?: Headers;
    returnHeaders?: boolean;
  }) => Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>;
  signInEmail: (input: {
    body: { email: string; password: string; rememberMe?: boolean };
    headers?: Headers;
    returnHeaders?: boolean;
  }) => Promise<
    EndpointResult<{ redirect: boolean; token: string; user: BetterAuthUser }>
  >;
  signInUsername: (input: {
    body: { username: string; password: string; rememberMe?: boolean };
    headers?: Headers;
    returnHeaders?: boolean;
  }) => Promise<
    EndpointResult<{ redirect?: boolean; token: string; user: BetterAuthUser }>
  >;
  getSession: (input: {
    headers: Headers;
    query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
  }) => Promise<{ session: BetterAuthSession; user: BetterAuthUser } | null>;
  signOut: (input: {
    headers: Headers;
    returnHeaders?: boolean;
  }) => Promise<EndpointResult<{ success: boolean }>>;
  listSessions: (input: { headers: Headers }) => Promise<BetterAuthSession[]>;
  revokeSession: (input: {
    body: { token: string };
    headers: Headers;
    returnHeaders?: boolean;
  }) => Promise<EndpointResult<{ status: boolean }>>;
  requestPasswordReset: (input: {
    body: { email: string; redirectTo?: string };
    headers?: Headers;
  }) => Promise<{ status: boolean; message: string }>;
  resetPassword: (input: {
    body: { newPassword: string; token?: string };
    headers?: Headers;
  }) => Promise<{ status: boolean }>;
  changePassword: (input: {
    body: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    };
    headers: Headers;
    returnHeaders?: boolean;
  }) => Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>;
}

interface AuthRows {
  user_id: string;
  user_no: string | number;
  display_username: string;
  email: string;
  email_verified: boolean;
  user_status: UserStatus;
  workspace_id: string;
  workspace_type: WorkspaceType;
  workspace_name: string;
  workspace_status: WorkspaceStatus;
  workspace_role: WorkspaceRole;
  plan_key: string;
}

interface AuthDeviceRow {
  id: string;
  user_agent: string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  current: boolean;
}

interface ActiveSessionRow {
  user_agent: string | null;
}

const DEFAULT_BASE_URL = "http://localhost:8787";
const DEFAULT_SECRET = "ai-canvas-cloud-dev-secret-change-me-in-env";
const BETTER_AUTH_FIELD_MAPPING = {
  user: {
    emailVerified: "email_verified",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  session: {
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
    ipAddress: "ip_address",
    userAgent: "user_agent",
    userId: "user_id",
  },
  account: {
    accountId: "account_id",
    providerId: "provider_id",
    userId: "user_id",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    idToken: "id_token",
    accessTokenExpiresAt: "access_token_expires_at",
    refreshTokenExpiresAt: "refresh_token_expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  verification: {
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

export function getAuthCookieSecurityOptions(environment?: string) {
  const secure = environment === "production" || environment === "staging";
  return {
    useSecureCookies: secure,
    defaultCookieAttributes: {
      secure,
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function toIsoString(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function getSetCookieHeaders(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }

  return splitSetCookieHeader(headers.get("set-cookie") ?? "");
}

function createRequestHeaders(context: AuthRequestContext) {
  const headers = new Headers();

  if (context.cookieHeader) {
    headers.set("cookie", context.cookieHeader);
  }

  if (context.userAgent) {
    headers.set("user-agent", context.userAgent);
  }

  if (context.ipAddress) {
    headers.set("x-forwarded-for", context.ipAddress);
  }

  return headers;
}

function toUserStatus(row: Pick<AuthRows, "user_status">): UserStatus {
  return row.user_status;
}

function toAuthSessionResponse(row: AuthRows): AuthSessionResponse {
  const userNumber = Number(row.user_no);

  if (!Number.isSafeInteger(userNumber) || userNumber < 10001) {
    throw new Error("Authenticated user number is invalid");
  }

  return {
    user: {
      id: row.user_id,
      userNumber,
      username: row.display_username,
      email: row.email,
      status: toUserStatus(row),
      emailVerified: row.email_verified,
    },
    workspace: {
      id: row.workspace_id,
      type: row.workspace_type,
      name: row.workspace_name,
      role: row.workspace_role,
      status: row.workspace_status,
      planKey: row.plan_key,
    },
  };
}

function toAuthSuccessResponse(
  row: AuthRows,
  expiresAt: Date | string,
): AuthSuccessResponse {
  return {
    ...toAuthSessionResponse(row),
    session: {
      expiresAt: toIsoString(expiresAt) ?? new Date().toISOString(),
    },
  };
}

function toSessionSummary(
  session: BetterAuthSession,
  currentToken: string | null,
): SessionSummary {
  const userAgent =
    "userAgent" in session && typeof session.userAgent === "string"
      ? session.userAgent
      : null;
  const ipAddress =
    "ipAddress" in session && typeof session.ipAddress === "string"
      ? session.ipAddress
      : null;

  return {
    id: session.id,
    deviceLabel: userAgent || ipAddress || null,
    createdAt: toIsoString(session.createdAt) ?? new Date().toISOString(),
    lastUsedAt:
      toIsoString(session.updatedAt) ??
      toIsoString(session.createdAt) ??
      new Date().toISOString(),
    expiresAt: toIsoString(session.expiresAt) ?? new Date().toISOString(),
    current: currentToken !== null && session.token === currentToken,
  };
}

function toDeviceSummary(row: AuthDeviceRow): DeviceSummary {
  return {
    id: row.id,
    deviceLabel: row.user_agent,
    firstSeenAt: toIsoString(row.first_seen_at) ?? new Date().toISOString(),
    lastSeenAt: toIsoString(row.last_seen_at) ?? new Date().toISOString(),
    current: row.current,
  };
}

function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

function toAuthServiceError(error: unknown): AuthServiceError {
  if (isApiError(error)) {
    const code = error.body?.code;
    const message = error.body?.message ?? error.message;

    if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") {
      return new AuthServiceError({
        statusCode: 400,
        apiCode: "VALIDATION_FAILED",
        message: message || "Password reset code is invalid or expired",
      });
    }

    if (error.statusCode === 401) {
      return new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Invalid account or password",
      });
    }

    if (error.statusCode === 403) {
      return new AuthServiceError({
        statusCode: 403,
        apiCode:
          code === "EMAIL_NOT_VERIFIED"
            ? "EMAIL_NOT_VERIFIED"
            : "ACCESS_DENIED",
        message: message || "Access denied",
      });
    }

    if (code === "USERNAME_IS_ALREADY_TAKEN") {
      return new AuthServiceError({
        statusCode: 409,
        apiCode: "USERNAME_UNAVAILABLE",
        message: "Username is already in use",
        details: { field: "username", reason: "taken" },
      });
    }

    if (error.statusCode === 422 || code === "USER_ALREADY_EXISTS") {
      return new AuthServiceError({
        statusCode: 409,
        apiCode: "VALIDATION_FAILED",
        message: message || "Email is already registered",
      });
    }

    return new AuthServiceError({
      statusCode:
        error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 503,
      apiCode:
        error.statusCode >= 400 && error.statusCode < 500
          ? "VALIDATION_FAILED"
          : "SERVICE_UNAVAILABLE",
      message: message || "Authentication failed",
      retryable: error.statusCode >= 500,
    });
  }

  if (error instanceof AuthServiceError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    typeof error.constraint === "string" &&
    error.constraint.includes("username")
  ) {
    return new AuthServiceError({
      statusCode: 409,
      apiCode: "USERNAME_UNAVAILABLE",
      message: "Username is already in use",
      details: { field: "username", reason: "taken" },
    });
  }

  return new AuthServiceError({
    statusCode: 503,
    apiCode: "SERVICE_UNAVAILABLE",
    message: "Authentication service failed",
    retryable: true,
  });
}

async function ensurePersonalWorkspace(
  client: Pick<DbClient, "query">,
  user: Pick<BetterAuthUser, "id" | "email">,
) {
  const workspaceResult = await client.query<{ id: string }>(
    `
      INSERT INTO workspaces (type, name, owner_user_id, status, plan_key)
      VALUES ('personal', $1, $2, 'active', 'free')
      ON CONFLICT (owner_user_id)
        WHERE type = 'personal' AND status <> 'deleted'
        DO UPDATE SET updated_at = workspaces.updated_at
      RETURNING id
    `,
    [createPersonalWorkspaceName(user.email), user.id],
  );
  const workspaceId = workspaceResult.rows[0]?.id;

  if (!workspaceId) {
    throw new Error("Failed to create workspace");
  }

  await client.query(
    `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [workspaceId, user.id],
  );
  await client.query(
    `
      INSERT INTO workspace_user_state (workspace_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [workspaceId, user.id],
  );

  return workspaceId;
}

async function getPrimaryWorkspace(
  client: Pick<DbClient, "query">,
  userId: string,
) {
  const result = await client.query<AuthRows>(
    `
      SELECT
        u.id AS user_id,
        u.user_no,
        u.display_username,
        u.email,
        u.email_verified,
        COALESCE(u.status, 'active') AS user_status,
        w.id AS workspace_id,
        w.type AS workspace_type,
        w.name AS workspace_name,
        w.status AS workspace_status,
        wm.role AS workspace_role,
        w.plan_key
      FROM "user" u
      JOIN workspace_members wm ON wm.user_id = u.id
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE u.id = $1
        AND COALESCE(u.status, 'active') = 'active'
        AND w.status <> 'deleted'
      ORDER BY CASE WHEN w.type = 'personal' THEN 0 ELSE 1 END, wm.joined_at ASC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

function resolveDeviceKey(
  deviceId: string | undefined,
  context: AuthRequestContext,
) {
  const provided = deviceId?.trim();

  if (provided) {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(provided)) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: "VALIDATION_FAILED",
        message: "Invalid device identifier",
      });
    }

    return provided;
  }

  const fallbackSource =
    context.userAgent || context.ipAddress || "unknown-device";
  return `legacy:${Buffer.from(fallbackSource).toString("base64url").slice(0, 96)}`;
}

async function findOtherActiveSession(
  client: Pick<DbClient, "query">,
  userId: string,
  currentToken: string,
) {
  const result = await client.query<ActiveSessionRow>(
    `
      SELECT user_agent
      FROM "session"
      WHERE user_id = $1
        AND token <> $2
        AND expires_at > now()
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId, currentToken],
  );

  return result.rows[0] ?? null;
}

async function deleteCurrentLoginAttempt(
  client: Pick<DbClient, "query">,
  userId: string,
  currentToken: string,
) {
  await client.query(
    'DELETE FROM "session" WHERE user_id = $1 AND token = $2',
    [userId, currentToken],
  );
}

async function revokeOtherUserSessions(
  client: Pick<DbClient, "query">,
  userId: string,
  currentToken: string,
) {
  await client.query(
    'DELETE FROM "session" WHERE user_id = $1 AND token <> $2',
    [userId, currentToken],
  );
}

async function upsertDeviceHistory(
  client: Pick<DbClient, "query">,
  options: {
    userId: string;
    currentToken: string | null;
    deviceKey: string;
    userAgent: string | null;
  },
) {
  if (!options.currentToken) {
    return;
  }

  await client.query(
    `
      INSERT INTO auth_devices (
        user_id,
        device_key,
        user_agent,
        first_seen_at,
        last_seen_at,
        last_session_id
      )
      SELECT $1, $2, $3, now(), now(), s.id
      FROM "session" s
      WHERE s.user_id = $1 AND s.token = $4
      ON CONFLICT (user_id, device_key) DO UPDATE
      SET user_agent = EXCLUDED.user_agent,
          last_seen_at = now(),
          last_session_id = EXCLUDED.last_session_id
    `,
    [
      options.userId,
      options.deviceKey,
      options.userAgent?.slice(0, 2048) || null,
      options.currentToken,
    ],
  );
  await client.query(
    `
      DELETE FROM auth_devices
      WHERE user_id = $1
        AND device_key LIKE 'legacy-session:%'
        AND device_key <> $2
        AND user_agent IS NOT DISTINCT FROM $3
    `,
    [
      options.userId,
      options.deviceKey,
      options.userAgent?.slice(0, 2048) || null,
    ],
  );
}

async function touchCurrentDevice(
  client: Pick<DbClient, "query">,
  sessionId: string,
) {
  await client.query(
    "UPDATE auth_devices SET last_seen_at = now() WHERE last_session_id = $1",
    [sessionId],
  );
}

function createDefaultBetterAuthApi(
  pool: DbPool,
  options: PostgresAuthServiceOptions,
): BetterAuthApi {
  const emailService = options.emailService
    ? createFailureTolerantAuthEmailService(options.emailService)
    : undefined;
  const passwordResetEmailCodes =
    options.passwordResetEmailCodes ??
    (emailService
      ? createPasswordResetEmailCodeService(pool, {
          secret:
            options.secret ?? process.env.BETTER_AUTH_SECRET ?? DEFAULT_SECRET,
          emailService,
        })
      : null);
  const auth = betterAuth({
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL ?? DEFAULT_BASE_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET ?? DEFAULT_SECRET,
    trustedOrigins: options.trustedOrigins,
    database: pool,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_CODE_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: passwordResetEmailCodes
        ? async ({ user, token }) => {
            await passwordResetEmailCodes.send(user.email, token);
          }
        : undefined,
    },
    user: {
      fields: BETTER_AUTH_FIELD_MAPPING.user,
      additionalFields: {
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
      },
    },
    session: {
      fields: BETTER_AUTH_FIELD_MAPPING.session,
    },
    account: {
      fields: BETTER_AUTH_FIELD_MAPPING.account,
    },
    verification: {
      fields: BETTER_AUTH_FIELD_MAPPING.verification,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameValidator: (value) => {
          try {
            normalizeUsername(value);
            return true;
          } catch {
            return false;
          }
        },
        displayUsernameValidator: (value) => {
          try {
            normalizeUsername(value);
            return true;
          } catch {
            return false;
          }
        },
        schema: {
          user: {
            fields: {
              username: "username",
              displayUsername: "display_username",
            },
          },
        },
      }),
    ],
    rateLimit: {
      enabled: true,
    },
    advanced: getAuthCookieSecurityOptions(options.environment),
  });

  return auth.api as unknown as BetterAuthApi;
}

export function createPostgresAuthService(
  pool: DbPool,
  options: PostgresAuthServiceOptions = {},
): AuthService {
  const authApi = options.authApi ?? createDefaultBetterAuthApi(pool, options);
  const registrationEmailCodes = options.emailService
    ? createRegistrationEmailCodeService(pool, {
        secret:
          options.secret ?? process.env.BETTER_AUTH_SECRET ?? DEFAULT_SECRET,
        emailService: options.emailService,
      })
    : null;
  const passwordResetEmailCodes =
    options.passwordResetEmailCodes ??
    (options.emailService
      ? createPasswordResetEmailCodeService(pool, {
          secret:
            options.secret ?? process.env.BETTER_AUTH_SECRET ?? DEFAULT_SECRET,
          emailService: options.emailService,
        })
      : null);
  const registrationEmailVerificationRequired =
    options.registrationEmailVerificationRequired ?? (async () => false);

  return {
    async register(input: RegisterRequest, context: AuthRequestContext) {
      try {
        const normalized = normalizeRegistrationInput(input);
        if (await registrationEmailVerificationRequired()) {
          if (!registrationEmailCodes) {
            throw new AuthServiceError({
              statusCode: 503,
              apiCode: "SERVICE_UNAVAILABLE",
              message: "Registration email verification is unavailable",
              retryable: true,
            });
          }
          await registrationEmailCodes.consume(
            normalized.emailNormalized,
            input.emailVerificationCode?.trim() ?? "",
          );
        }
        const deviceKey = resolveDeviceKey(input.deviceId, context);
        const result = await authApi.signUpEmail({
          body: {
            email: normalized.emailNormalized,
            password: normalized.password,
            name: normalized.displayUsername,
            username: normalized.usernameNormalized,
            displayUsername: normalized.displayUsername,
            rememberMe: true,
          },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        });

        await pool.query(
          `
            UPDATE "user"
            SET email_verified = true, updated_at = now()
            WHERE id = $1
          `,
          [result.response.user.id],
        );

        await ensurePersonalWorkspace(pool, result.response.user);
        await upsertDeviceHistory(pool, {
          userId: result.response.user.id,
          currentToken: result.response.token,
          deviceKey,
          userAgent: context.userAgent ?? null,
        });
        const row = await getPrimaryWorkspace(pool, result.response.user.id);

        if (!row) {
          throw new Error("Failed to load registered workspace");
        }

        return {
          response: toAuthSuccessResponse(
            row,
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          ),
          setCookieHeaders: getSetCookieHeaders(result.headers),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async sendRegistrationEmailCode(
      input: RegistrationEmailCodeRequest,
    ): Promise<RegistrationEmailCodeResponse> {
      try {
        const email = normalizeEmail(input.email);
        if (!(await registrationEmailVerificationRequired())) {
          return { ok: true, resendAfterSeconds: 0 };
        }
        if (!registrationEmailCodes) {
          throw new AuthServiceError({
            statusCode: 503,
            apiCode: "SERVICE_UNAVAILABLE",
            message: "Registration email verification is unavailable",
            retryable: true,
          });
        }
        return await registrationEmailCodes.send(email);
      } catch (error) {
        if (error instanceof AuthServiceError) throw error;
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "Invalid email address",
        });
      }
    },

    async login(input: LoginRequest, context: AuthRequestContext) {
      try {
        const identifier = normalizeLoginIdentifier(input.identifier);
        const deviceKey = resolveDeviceKey(input.deviceId, context);
        const request = {
          headers: createRequestHeaders(context),
          returnHeaders: true as const,
        };
        const result =
          identifier.type === "email"
            ? await authApi.signInEmail({
                ...request,
                body: {
                  email: identifier.value,
                  password: input.password,
                  rememberMe: true,
                },
              })
            : await authApi.signInUsername({
                ...request,
                body: {
                  username: identifier.value,
                  password: input.password,
                  rememberMe: true,
                },
              });

        const otherActiveSession = await findOtherActiveSession(
          pool,
          result.response.user.id,
          result.response.token,
        );

        if (otherActiveSession && !input.force) {
          await deleteCurrentLoginAttempt(
            pool,
            result.response.user.id,
            result.response.token,
          );
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "ACTIVE_SESSION_EXISTS",
            message: "This account is already signed in on another device",
            details: {
              activeDeviceLabel: otherActiveSession.user_agent,
            },
          });
        }

        await revokeOtherUserSessions(
          pool,
          result.response.user.id,
          result.response.token,
        );

        await ensurePersonalWorkspace(pool, result.response.user);
        await upsertDeviceHistory(pool, {
          userId: result.response.user.id,
          currentToken: result.response.token,
          deviceKey,
          userAgent: context.userAgent ?? null,
        });
        const row = await getPrimaryWorkspace(pool, result.response.user.id);

        if (!row) {
          await deleteCurrentLoginAttempt(
            pool,
            result.response.user.id,
            result.response.token,
          );
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: "ACCESS_DENIED",
            message: "Account access is disabled",
          });
        }

        return {
          response: toAuthSuccessResponse(
            row,
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          ),
          setCookieHeaders: getSetCookieHeaders(result.headers),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async getSession(context: AuthRequestContext) {
      try {
        const session = await authApi.getSession({
          headers: createRequestHeaders(context),
          query: {
            disableCookieCache: true,
          },
        });

        if (!session) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: "SESSION_EXPIRED",
            message: "Session expired",
          });
        }

        await ensurePersonalWorkspace(pool, session.user);
        await touchCurrentDevice(pool, session.session.id);
        const row = await getPrimaryWorkspace(pool, session.user.id);

        if (!row) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: "ACCESS_DENIED",
            message: "Workspace is not available",
          });
        }

        return toAuthSessionResponse(row);
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async listSessions(
      context: AuthRequestContext,
    ): Promise<AuthSessionsResponse> {
      try {
        const headers = createRequestHeaders(context);
        const currentSession = await authApi.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        });

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: "SESSION_EXPIRED",
            message: "Session expired",
          });
        }

        const sessions = await authApi.listSessions({ headers });

        return {
          sessions: sessions
            .map((session) =>
              toSessionSummary(session, currentSession.session.token),
            )
            .sort(
              (left, right) =>
                Number(right.current) - Number(left.current) ||
                new Date(right.lastUsedAt).getTime() -
                  new Date(left.lastUsedAt).getTime(),
            ),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async listDevices(
      context: AuthRequestContext,
    ): Promise<AuthDevicesResponse> {
      try {
        const currentSession = await authApi.getSession({
          headers: createRequestHeaders(context),
          query: {
            disableCookieCache: true,
          },
        });

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: "SESSION_EXPIRED",
            message: "Session expired",
          });
        }

        await touchCurrentDevice(pool, currentSession.session.id);
        const result = await pool.query<AuthDeviceRow>(
          `
            SELECT
              id::text,
              user_agent,
              first_seen_at,
              last_seen_at,
              last_session_id = $2 AS current
            FROM auth_devices
            WHERE user_id = $1
            ORDER BY current DESC, last_seen_at DESC
          `,
          [currentSession.user.id, currentSession.session.id],
        );

        return {
          devices: result.rows.map(toDeviceSummary),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async requestPasswordReset(
      input: PasswordForgotRequest,
      context: AuthRequestContext,
    ): Promise<PasswordResetResponse> {
      try {
        const email = normalizeEmail(input.email);

        if (!(await passwordResetEmailCodes?.isCoolingDown(email))) {
          await authApi.requestPasswordReset({
            body: {
              email,
            },
            headers: createRequestHeaders(context),
          });
        }

        return { ok: true };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Invalid email address"
        ) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: "VALIDATION_FAILED",
            message: "Invalid email address",
          });
        }

        throw toAuthServiceError(error);
      }
    },

    async resetPassword(
      input: PasswordResetRequest,
      context: AuthRequestContext,
    ): Promise<PasswordResetResponse> {
      try {
        const email = normalizeEmail(input.email);
        const code = input.code.trim();

        if (!passwordResetEmailCodes) {
          throw new AuthServiceError({
            statusCode: 503,
            apiCode: "SERVICE_UNAVAILABLE",
            message: "Password reset email verification is unavailable",
            retryable: true,
          });
        }

        try {
          validatePassword(input.password);
        } catch (error) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: "VALIDATION_FAILED",
            message:
              error instanceof Error ? error.message : "Invalid password",
          });
        }

        const token = await passwordResetEmailCodes.consume(email, code);

        await authApi.resetPassword({
          body: {
            newPassword: input.password,
            token,
          },
          headers: createRequestHeaders(context),
        });

        return { ok: true };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async changePassword(
      input: PasswordChangeRequest,
      context: AuthRequestContext,
    ): Promise<
      RevokedAuthSession & {
        response: PasswordChangeResponse;
      }
    > {
      try {
        validatePassword(input.currentPassword);
        validatePassword(input.newPassword);

        if (input.currentPassword === input.newPassword) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: "VALIDATION_FAILED",
            message: "New password must be different from the current password",
          });
        }

        const result = await authApi.changePassword({
          body: {
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            revokeOtherSessions: true,
          },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        });

        return {
          response: { ok: true },
          setCookieHeaders: getSetCookieHeaders(result.headers),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async revokeSession(
      sessionId: string,
      context: AuthRequestContext,
    ): Promise<
      RevokedAuthSession & {
        response: RevokeSessionResponse;
      }
    > {
      try {
        const headers = createRequestHeaders(context);
        const currentSession = await authApi.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        });

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: "SESSION_EXPIRED",
            message: "Session expired",
          });
        }

        const sessions = await authApi.listSessions({ headers });
        const targetSession = sessions.find(
          (session) => session.id === sessionId,
        );

        if (!targetSession) {
          throw new AuthServiceError({
            statusCode: 404,
            apiCode: "RESOURCE_NOT_FOUND",
            message: "Session not found",
          });
        }

        if (targetSession.token === currentSession.session.token) {
          const result = await authApi.signOut({
            headers,
            returnHeaders: true,
          });

          return {
            response: { ok: true },
            setCookieHeaders: getSetCookieHeaders(result.headers),
          };
        }

        await authApi.revokeSession({
          body: {
            token: targetSession.token,
          },
          headers,
          returnHeaders: true,
        });

        return {
          response: { ok: true },
          setCookieHeaders: [],
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async removeDevice(
      deviceId: string,
      context: AuthRequestContext,
    ): Promise<RemoveDeviceResponse> {
      try {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            deviceId,
          )
        ) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: "VALIDATION_FAILED",
            message: "Invalid device identifier",
          });
        }

        const currentSession = await authApi.getSession({
          headers: createRequestHeaders(context),
          query: {
            disableCookieCache: true,
          },
        });

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: "SESSION_EXPIRED",
            message: "Session expired",
          });
        }

        const target = await pool.query<{
          id: string;
          last_session_id: string | null;
          current: boolean;
        }>(
          `
            SELECT id::text, last_session_id, last_session_id = $3 AS current
            FROM auth_devices
            WHERE id = $1 AND user_id = $2
          `,
          [deviceId, currentSession.user.id, currentSession.session.id],
        );
        const device = target.rows[0];

        if (!device) {
          throw new AuthServiceError({
            statusCode: 404,
            apiCode: "RESOURCE_NOT_FOUND",
            message: "Device not found",
          });
        }

        if (device.current) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: "VALIDATION_FAILED",
            message: "Current device cannot be removed",
          });
        }

        if (device.last_session_id) {
          await pool.query(
            'DELETE FROM "session" WHERE id = $1 AND user_id = $2',
            [device.last_session_id, currentSession.user.id],
          );
        }
        await pool.query(
          "DELETE FROM auth_devices WHERE id = $1 AND user_id = $2",
          [deviceId, currentSession.user.id],
        );

        return { ok: true };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },

    async logout(context: AuthRequestContext) {
      try {
        const result = await authApi.signOut({
          headers: createRequestHeaders(context),
          returnHeaders: true,
        });

        return {
          setCookieHeaders: getSetCookieHeaders(result.headers),
        };
      } catch (error) {
        throw toAuthServiceError(error);
      }
    },
  };
}
