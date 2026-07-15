import { betterAuth, APIError } from 'better-auth'
import { splitSetCookieHeader } from 'better-auth/cookies'
import type {
  AuthSessionResponse,
  AuthSessionsResponse,
  AuthSuccessResponse,
  EmailVerificationResponse,
  EmailVerifyRequest,
  LoginRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  RegisterRequest,
  RevokeSessionResponse,
  SessionSummary,
  UserStatus,
  WorkspaceRole,
  WorkspaceStatus,
  WorkspaceType,
} from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { AuthServiceError, createPersonalWorkspaceName, normalizeEmail, normalizeRegistrationInput, validatePassword, type AuthRequestContext, type AuthService, type RevokedAuthSession } from './service.js'
import type { AuthEmailService } from './email.js'

export interface PostgresAuthServiceOptions {
  baseURL?: string
  secret?: string
  publicWebUrl?: string
  trustedOrigins?: string[]
  emailService?: AuthEmailService
  authApi?: BetterAuthApi
}

interface BetterAuthUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
  image?: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

interface BetterAuthSession {
  id: string
  token: string
  userId: string
  expiresAt: Date | string
  createdAt: Date | string
  updatedAt: Date | string
}

interface EndpointResult<T> {
  response: T
  headers: Headers
}

interface BetterAuthApi {
  signUpEmail: (input: {
    body: { email: string; password: string; name: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }) => Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>
  signInEmail: (input: {
    body: { email: string; password: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }) => Promise<EndpointResult<{ redirect: boolean; token: string; user: BetterAuthUser }>>
  getSession: (input: {
    headers: Headers
    query?: { disableCookieCache?: boolean; disableRefresh?: boolean }
  }) => Promise<{ session: BetterAuthSession; user: BetterAuthUser } | null>
  signOut: (input: {
    headers: Headers
    returnHeaders?: boolean
  }) => Promise<EndpointResult<{ success: boolean }>>
  listSessions: (input: {
    headers: Headers
  }) => Promise<BetterAuthSession[]>
  revokeSession: (input: {
    body: { token: string }
    headers: Headers
    returnHeaders?: boolean
  }) => Promise<EndpointResult<{ status: boolean }>>
  sendVerificationEmail: (input: {
    body: { email: string; callbackURL?: string }
    headers?: Headers
  }) => Promise<{ status: boolean }>
  verifyEmail: (input: {
    query: { token: string; callbackURL?: string }
    headers?: Headers
  }) => Promise<{ status: boolean } | void>
  requestPasswordReset: (input: {
    body: { email: string; redirectTo?: string }
    headers?: Headers
  }) => Promise<{ status: boolean; message: string }>
  resetPassword: (input: {
    body: { newPassword: string; token?: string }
    headers?: Headers
  }) => Promise<{ status: boolean }>
}

interface AuthRows {
  user_id: string
  email: string
  email_verified: boolean
  user_status: UserStatus
  workspace_id: string
  workspace_type: WorkspaceType
  workspace_name: string
  workspace_status: WorkspaceStatus
  workspace_role: WorkspaceRole
  plan_key: string
}

const DEFAULT_BASE_URL = 'http://localhost:8787'
const DEFAULT_SECRET = 'ai-canvas-cloud-dev-secret-change-me-in-env'
const DEFAULT_PUBLIC_WEB_URL = 'http://localhost:5173'
const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60
const PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60
const BETTER_AUTH_FIELD_MAPPING = {
  user: {
    emailVerified: 'email_verified',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  session: {
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
    userId: 'user_id',
  },
  account: {
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    idToken: 'id_token',
    accessTokenExpiresAt: 'access_token_expires_at',
    refreshTokenExpiresAt: 'refresh_token_expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  verification: {
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const

function toIsoString(value: Date | string | null) {
  if (!value) {
    return null
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function getSetCookieHeaders(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers)
  }

  return splitSetCookieHeader(headers.get('set-cookie') ?? '')
}

function createRequestHeaders(context: AuthRequestContext) {
  const headers = new Headers()

  if (context.cookieHeader) {
    headers.set('cookie', context.cookieHeader)
  }

  if (context.userAgent) {
    headers.set('user-agent', context.userAgent)
  }

  if (context.ipAddress) {
    headers.set('x-forwarded-for', context.ipAddress)
  }

  return headers
}

function toUserStatus(row: Pick<AuthRows, 'user_status'>): UserStatus {
  return row.user_status
}

function toAuthSessionResponse(row: AuthRows): AuthSessionResponse {
  return {
    user: {
      id: row.user_id,
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
  }
}

function toAuthSuccessResponse(row: AuthRows, expiresAt: Date | string): AuthSuccessResponse {
  return {
    ...toAuthSessionResponse(row),
    session: {
      expiresAt: toIsoString(expiresAt) ?? new Date().toISOString(),
    },
  }
}

function getUserDisplayName(emailNormalized: string) {
  const [localPart] = emailNormalized.split('@')
  return localPart?.trim() || emailNormalized
}

function createPublicEmailVerificationUrl(publicWebUrl: string, token: string) {
  const url = new URL('/auth/verify-email', publicWebUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function createPublicPasswordResetUrl(publicWebUrl: string, token: string) {
  const url = new URL('/auth/reset-password', publicWebUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function toSessionSummary(session: BetterAuthSession, currentToken: string | null): SessionSummary {
  const userAgent = 'userAgent' in session && typeof session.userAgent === 'string' ? session.userAgent : null
  const ipAddress = 'ipAddress' in session && typeof session.ipAddress === 'string' ? session.ipAddress : null

  return {
    id: session.id,
    deviceLabel: userAgent || ipAddress || null,
    lastUsedAt: toIsoString(session.updatedAt) ?? toIsoString(session.createdAt) ?? new Date().toISOString(),
    expiresAt: toIsoString(session.expiresAt) ?? new Date().toISOString(),
    current: currentToken !== null && session.token === currentToken,
  }
}

function isApiError(error: unknown): error is APIError {
  return error instanceof APIError
}

function toAuthServiceError(error: unknown): AuthServiceError {
  if (isApiError(error)) {
    const code = error.body?.code
    const message = error.body?.message ?? error.message

    if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') {
      return new AuthServiceError({
        statusCode: 400,
        apiCode: 'VALIDATION_FAILED',
        message: message || 'Verification link is invalid or expired',
      })
    }

    if (error.statusCode === 401) {
      return new AuthServiceError({
        statusCode: 401,
        apiCode: 'AUTH_REQUIRED',
        message: message || 'Invalid email or password',
      })
    }

    if (error.statusCode === 403) {
      return new AuthServiceError({
        statusCode: 403,
        apiCode: code === 'EMAIL_NOT_VERIFIED' ? 'EMAIL_NOT_VERIFIED' : 'ACCESS_DENIED',
        message: message || 'Access denied',
      })
    }

    if (error.statusCode === 422 || code === 'USER_ALREADY_EXISTS') {
      return new AuthServiceError({
        statusCode: 409,
        apiCode: 'VALIDATION_FAILED',
        message: message || 'Email is already registered',
      })
    }

    return new AuthServiceError({
      statusCode: error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503,
      apiCode: error.statusCode >= 400 && error.statusCode < 500 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
      message: message || 'Authentication failed',
      retryable: error.statusCode >= 500,
    })
  }

  if (error instanceof AuthServiceError) {
    return error
  }

  return new AuthServiceError({
    statusCode: 503,
    apiCode: 'SERVICE_UNAVAILABLE',
    message: 'Authentication service failed',
    retryable: true,
  })
}

async function ensurePersonalWorkspace(client: Pick<DbClient, 'query'>, user: Pick<BetterAuthUser, 'id' | 'email'>) {
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
  )
  const workspaceId = workspaceResult.rows[0]?.id

  if (!workspaceId) {
    throw new Error('Failed to create workspace')
  }

  await client.query(
    `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [workspaceId, user.id],
  )
  await client.query(
    `
      INSERT INTO workspace_user_state (workspace_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [workspaceId, user.id],
  )

  return workspaceId
}

async function getPrimaryWorkspace(client: Pick<DbClient, 'query'>, userId: string) {
  const result = await client.query<AuthRows>(
    `
      SELECT
        u.id AS user_id,
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
        AND COALESCE(u.status, 'active') <> 'deleted'
        AND w.status <> 'deleted'
      ORDER BY CASE WHEN w.type = 'personal' THEN 0 ELSE 1 END, wm.joined_at ASC
      LIMIT 1
    `,
    [userId],
  )

  return result.rows[0] ?? null
}

async function revokeOtherUserSessions(
  client: Pick<DbClient, 'query'>,
  userId: string,
  currentToken: string | null | undefined,
) {
  if (!currentToken) {
    return
  }

  await client.query(
    `
      DELETE FROM "session"
      WHERE user_id = $1
        AND token <> $2
    `,
    [userId, currentToken],
  )
}

function createDefaultBetterAuthApi(pool: DbPool, options: PostgresAuthServiceOptions): BetterAuthApi {
  const publicWebUrl = options.publicWebUrl ?? process.env.WEB_PUBLIC_URL ?? DEFAULT_PUBLIC_WEB_URL
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
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: options.emailService
        ? async ({ user, token }) => {
            await options.emailService?.sendPasswordResetEmail({
              to: user.email,
              resetUrl: createPublicPasswordResetUrl(publicWebUrl, token),
              expiresInSeconds: PASSWORD_RESET_EXPIRES_IN_SECONDS,
            })
          }
        : undefined,
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      sendVerificationEmail: options.emailService
        ? async ({ user, token }) => {
            await options.emailService?.sendVerificationEmail({
              to: user.email,
              verificationUrl: createPublicEmailVerificationUrl(publicWebUrl, token),
              expiresInSeconds: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
            })
          }
        : undefined,
    },
    user: {
      fields: BETTER_AUTH_FIELD_MAPPING.user,
      additionalFields: {
        status: {
          type: 'string',
          required: false,
          defaultValue: 'active',
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
    rateLimit: {
      enabled: true,
    },
  })

  return auth.api as unknown as BetterAuthApi
}

export function createPostgresAuthService(
  pool: DbPool,
  options: PostgresAuthServiceOptions = {},
): AuthService {
  const authApi = options.authApi ?? createDefaultBetterAuthApi(pool, options)

  return {
    async register(input: RegisterRequest, context: AuthRequestContext) {
      try {
        const normalized = normalizeRegistrationInput(input)
        const result = await authApi.signUpEmail({
          body: {
            email: normalized.emailNormalized,
            password: normalized.password,
            name: getUserDisplayName(normalized.emailNormalized),
            rememberMe: true,
          },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })

        await ensurePersonalWorkspace(pool, result.response.user)
        await revokeOtherUserSessions(pool, result.response.user.id, result.response.token)
        const row = await getPrimaryWorkspace(pool, result.response.user.id)

        if (!row) {
          throw new Error('Failed to load registered workspace')
        }

        return {
          response: toAuthSuccessResponse(row, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async login(input: LoginRequest, context: AuthRequestContext) {
      try {
        const emailNormalized = input.email.trim().toLowerCase()
        const result = await authApi.signInEmail({
          body: {
            email: emailNormalized,
            password: input.password,
            rememberMe: true,
          },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })

        await ensurePersonalWorkspace(pool, result.response.user)
        await revokeOtherUserSessions(pool, result.response.user.id, result.response.token)
        const row = await getPrimaryWorkspace(pool, result.response.user.id)

        if (!row) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: 'ACCESS_DENIED',
            message: 'Workspace is not available',
          })
        }

        return {
          response: toAuthSuccessResponse(row, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async getSession(context: AuthRequestContext) {
      try {
        const session = await authApi.getSession({
          headers: createRequestHeaders(context),
          query: {
            disableCookieCache: true,
          },
        })

        if (!session) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: 'SESSION_EXPIRED',
            message: 'Session expired',
          })
        }

        await ensurePersonalWorkspace(pool, session.user)
        const row = await getPrimaryWorkspace(pool, session.user.id)

        if (!row) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: 'ACCESS_DENIED',
            message: 'Workspace is not available',
          })
        }

        return toAuthSessionResponse(row)
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async listSessions(context: AuthRequestContext): Promise<AuthSessionsResponse> {
      try {
        const headers = createRequestHeaders(context)
        const currentSession = await authApi.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        })

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: 'SESSION_EXPIRED',
            message: 'Session expired',
          })
        }

        const sessions = await authApi.listSessions({ headers })

        return {
          sessions: sessions
            .map((session) => toSessionSummary(session, currentSession.session.token))
            .sort((left, right) => Number(right.current) - Number(left.current)
              || new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime()),
        }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async resendVerificationEmail(context: AuthRequestContext): Promise<EmailVerificationResponse> {
      try {
        const headers = createRequestHeaders(context)
        const currentSession = await authApi.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        })

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: 'SESSION_EXPIRED',
            message: 'Session expired',
          })
        }

        if (currentSession.user.emailVerified) {
          return { ok: true }
        }

        await authApi.sendVerificationEmail({
          body: {
            email: currentSession.user.email,
            callbackURL: '/',
          },
          headers,
        })

        return { ok: true }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async verifyEmail(input: EmailVerifyRequest, context: AuthRequestContext): Promise<EmailVerificationResponse> {
      try {
        const token = input.token.trim()

        if (!token) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: 'VALIDATION_FAILED',
            message: 'Verification token is required',
          })
        }

        await authApi.verifyEmail({
          query: {
            token,
          },
          headers: createRequestHeaders(context),
        })

        return { ok: true }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async requestPasswordReset(input: PasswordForgotRequest, context: AuthRequestContext): Promise<PasswordResetResponse> {
      try {
        const email = normalizeEmail(input.email)

        await authApi.requestPasswordReset({
          body: {
            email,
          },
          headers: createRequestHeaders(context),
        })

        return { ok: true }
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid email address') {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: 'VALIDATION_FAILED',
            message: 'Invalid email address',
          })
        }

        throw toAuthServiceError(error)
      }
    },

    async resetPassword(input: PasswordResetRequest, context: AuthRequestContext): Promise<PasswordResetResponse> {
      try {
        const token = input.token.trim()

        if (!token) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: 'VALIDATION_FAILED',
            message: 'Reset token is required',
          })
        }

        try {
          validatePassword(input.password)
        } catch (error) {
          throw new AuthServiceError({
            statusCode: 400,
            apiCode: 'VALIDATION_FAILED',
            message: error instanceof Error ? error.message : 'Invalid password',
          })
        }

        await authApi.resetPassword({
          body: {
            newPassword: input.password,
            token,
          },
          headers: createRequestHeaders(context),
        })

        return { ok: true }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async revokeSession(sessionId: string, context: AuthRequestContext): Promise<RevokedAuthSession & {
      response: RevokeSessionResponse
    }> {
      try {
        const headers = createRequestHeaders(context)
        const currentSession = await authApi.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        })

        if (!currentSession) {
          throw new AuthServiceError({
            statusCode: 401,
            apiCode: 'SESSION_EXPIRED',
            message: 'Session expired',
          })
        }

        const sessions = await authApi.listSessions({ headers })
        const targetSession = sessions.find((session) => session.id === sessionId)

        if (!targetSession) {
          throw new AuthServiceError({
            statusCode: 404,
            apiCode: 'RESOURCE_NOT_FOUND',
            message: 'Session not found',
          })
        }

        if (targetSession.token === currentSession.session.token) {
          const result = await authApi.signOut({
            headers,
            returnHeaders: true,
          })

          return {
            response: { ok: true },
            setCookieHeaders: getSetCookieHeaders(result.headers),
          }
        }

        await authApi.revokeSession({
          body: {
            token: targetSession.token,
          },
          headers,
          returnHeaders: true,
        })

        return {
          response: { ok: true },
          setCookieHeaders: [],
        }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },

    async logout(context: AuthRequestContext) {
      try {
        const result = await authApi.signOut({
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })

        return {
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw toAuthServiceError(error)
      }
    },
  }
}
