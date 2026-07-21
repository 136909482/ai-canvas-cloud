import { APIError, betterAuth } from 'better-auth'
import { splitSetCookieHeader } from 'better-auth/cookies'
import { twoFactor } from 'better-auth/plugins'
import type { DbPool } from '../../db/postgres.js'
import { AdminAccessError, assertAdminAccess, hashAdminRequestIdentity, redactAdminAuditPayload } from './security.js'
import type { AdminAuditQuery, AdminService } from './service.js'
import { ADMIN_ROLES, type AdminAuditEvent, type AdminPrincipal, type AdminRequestContext, type AdminRole, type AdminSession } from './types.js'

const COOKIE_PREFIX = 'ai_canvas_admin'
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

export interface PostgresAdminServiceOptions {
  baseURL: string
  secret: string
  trustedOrigins: string[]
  environment: string
  issuer?: string
  authApi?: AdminBetterAuthApi
}

interface BetterAuthUser {
  id: string
  email: string
  role?: unknown
  status?: unknown
  twoFactorEnabled?: unknown
}

interface BetterAuthSession {
  id: string
  token: string
  userId: string
  expiresAt: Date | string
}

interface EndpointResult<T> {
  response: T
  headers: Headers
}

export interface AdminBetterAuthApi {
  signUpEmail(input: {
    body: { email: string; password: string; name: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>
  signInEmail(input: {
    body: { email: string; password: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<
    | { token: string; user: BetterAuthUser; twoFactorRedirect?: false }
    | { twoFactorRedirect: true; twoFactorMethods: string[] }
  >>
  getSession(input: {
    headers: Headers
    query?: { disableCookieCache?: boolean; disableRefresh?: boolean }
  }): Promise<{ session: BetterAuthSession; user: BetterAuthUser } | null>
  enableTwoFactor(input: {
    body: { password: string; issuer?: string }
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ totpURI: string; backupCodes: string[] }>>
  verifyTOTP(input: {
    body: { code: string; trustDevice?: boolean }
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token: string; user: BetterAuthUser }>>
  verifyBackupCode(input: {
    body: { code: string; trustDevice?: boolean; disableSession?: boolean }
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token?: string; user: BetterAuthUser }>>
  generateBackupCodes(input: {
    body: { password: string }
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ status: boolean; backupCodes: string[] }>>
  generateTOTP(input: {
    body: { secret: string }
  }): Promise<{ code: string }>
  signOut(input: {
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ success: boolean }>>
}

interface AdminUserRow {
  id: string
  email: string
  role: AdminRole
  status: 'active' | 'banned'
  two_factor_enabled: boolean
}

interface AdminSessionRow extends AdminUserRow {
  expires_at: Date | string
}

interface AdminAuditRow {
  id: string
  admin_user_id: string | null
  admin_role: AdminRole | null
  action: string
  target_type: string | null
  target_id: string | null
  result: 'success' | 'failure'
  request_id: string
  before_json: Record<string, unknown>
  after_json: Record<string, unknown>
  created_at: Date | string
}

function createRequestHeaders(context: AdminRequestContext) {
  const headers = new Headers()
  if (context.cookieHeader) headers.set('cookie', context.cookieHeader)
  if (context.userAgent) headers.set('user-agent', context.userAgent)
  if (context.ipAddress) headers.set('x-forwarded-for', context.ipAddress)
  return headers
}

function getSetCookieHeaders(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers)
  return splitSetCookieHeader(headers.get('set-cookie') ?? '')
}

function parseRole(value: unknown): AdminRole {
  if (typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole)) return value as AdminRole
  throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator role is invalid')
}

function toPrincipal(row: AdminUserRow): AdminPrincipal {
  return {
    id: row.id,
    email: row.email,
    role: parseRole(row.role),
    status: row.status,
    twoFactorEnabled: row.two_factor_enabled,
  }
}

function toSession(row: AdminSessionRow): AdminSession {
  return {
    admin: toPrincipal(row),
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

function toAuditEvent(row: AdminAuditRow): AdminAuditEvent {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    adminRole: row.admin_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    requestId: row.request_id,
    before: row.before_json,
    after: row.after_json,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator email is invalid')
  }
  return email
}

function validatePassword(value: string) {
  if (value.length < 12 || value.length > 256) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator password must be 12 to 256 characters')
  }
}

function validateCode(value: string, pattern: RegExp, message: string) {
  const code = value.trim()
  if (!pattern.test(code)) throw new AdminAccessError(400, 'VALIDATION_FAILED', message)
  return code
}

function mapAuthError(error: unknown) {
  if (error instanceof AdminAccessError) return error
  if (error instanceof APIError) {
    if (error.statusCode === 401) return new AdminAccessError(401, 'AUTH_REQUIRED', 'Administrator authentication failed')
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator authentication request was rejected')
    }
  }
  return new AdminAccessError(503, 'SERVICE_UNAVAILABLE', 'Administrator authentication service failed')
}

function cookieSecurityOptions(environment: string) {
  const secure = environment === 'production' || environment === 'staging'
  return {
    cookiePrefix: COOKIE_PREFIX,
    useSecureCookies: secure,
    defaultCookieAttributes: {
      secure,
      httpOnly: true,
      sameSite: 'strict' as const,
      path: '/',
    },
  }
}

export function createAdminBetterAuthApi(pool: DbPool, options: PostgresAdminServiceOptions): AdminBetterAuthApi {
  const auth = betterAuth({
    appName: options.issuer ?? 'AI Canvas Admin',
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: pool,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      autoSignIn: true,
    },
    user: {
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'auditor', input: false },
        status: { type: 'string', required: true, defaultValue: 'active', input: false },
      },
    },
    session: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
    },
    account: {
      fields: {
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
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [twoFactor({
      issuer: options.issuer ?? 'AI Canvas Admin',
      twoFactorTable: 'two_factor',
      twoFactorCookieMaxAge: 300,
      trustDeviceMaxAge: 0,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      schema: {
        user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
        twoFactor: {
          fields: {
            backupCodes: 'backup_codes',
            userId: 'user_id',
            failedVerificationCount: 'failed_verification_count',
            lockedUntil: 'locked_until',
          },
        },
      },
    })],
    rateLimit: { enabled: options.environment !== 'test', window: 60, max: 10 },
    advanced: cookieSecurityOptions(options.environment),
  })
  return auth.api as unknown as AdminBetterAuthApi
}

async function findAdminByEmail(pool: DbPool, email: string) {
  const result = await pool.query<AdminUserRow>(
    'SELECT id, email, role, status, two_factor_enabled FROM "user" WHERE email = $1',
    [email],
  )
  return result.rows[0] ?? null
}

async function getSessionByToken(pool: DbPool, token: string) {
  const result = await pool.query<AdminSessionRow>(
    `
      SELECT u.id, u.email, u.role, u.status, u.two_factor_enabled, s.expires_at
      FROM "session" s
      JOIN "user" u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()
    `,
    [token],
  )
  return result.rows[0] ? toSession(result.rows[0]) : null
}

async function requireRawSession(pool: DbPool, authApi: AdminBetterAuthApi, context: AdminRequestContext) {
  const session = await authApi.getSession({
    headers: createRequestHeaders(context),
    query: { disableCookieCache: true, disableRefresh: true },
  })
  if (!session) throw new AdminAccessError(401, 'AUTH_REQUIRED', 'Administrator session is missing or expired')
  const resolved = await getSessionByToken(pool, session.session.token)
  if (!resolved) throw new AdminAccessError(401, 'AUTH_REQUIRED', 'Administrator session is missing or expired')
  if (resolved.admin.status === 'banned') {
    throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator access is disabled')
  }
  return resolved
}

function encodeCursor(row: Pick<AdminAuditEvent, 'createdAt' | 'id'>) {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url')
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') throw new Error()
    const date = new Date(value[0])
    if (Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(value[1])) throw new Error()
    return [date.toISOString(), value[1]] as const
  } catch {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Audit cursor is invalid')
  }
}

function validateAuditQuery(query: AdminAuditQuery) {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Audit page size is invalid')
  }
  if (query.action && (!/^[a-z0-9_.:-]{1,96}$/i.test(query.action))) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Audit action filter is invalid')
  }
  return { limit, cursor: decodeCursor(query.cursor) }
}

export function createPostgresAdminService(pool: DbPool, options: PostgresAdminServiceOptions): AdminService {
  const authApi = options.authApi ?? createAdminBetterAuthApi(pool, options)

  const service: AdminService = {
    async login(input, context) {
      try {
        const email = normalizeEmail(input.email)
        validatePassword(input.password)
        const existing = await findAdminByEmail(pool, email)
        if (existing?.status === 'banned') {
          throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator access is disabled')
        }
        const result = await authApi.signInEmail({
          body: { email, password: input.password, rememberMe: false },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        const setCookieHeaders = getSetCookieHeaders(result.headers)
        if ('twoFactorRedirect' in result.response && result.response.twoFactorRedirect) {
          return {
            response: { state: 'mfa_required', methods: ['totp', 'backup_code'] },
            setCookieHeaders,
          }
        }
        const session = await getSessionByToken(pool, result.response.token)
        if (!session) throw new Error('Created administrator session was not found')
        return {
          response: {
            state: session.admin.twoFactorEnabled ? 'authenticated' : 'mfa_setup_required',
            session,
          },
          setCookieHeaders,
        }
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async getSession(context) {
      try {
        return await requireRawSession(pool, authApi, context)
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async setupTotp(input, context) {
      try {
        validatePassword(input.password)
        const session = await requireRawSession(pool, authApi, context)
        if (session.admin.twoFactorEnabled) {
          throw new AdminAccessError(409, 'VALIDATION_FAILED', 'Multi-factor authentication is already enabled')
        }
        const result = await authApi.enableTwoFactor({
          body: { password: input.password, issuer: options.issuer ?? 'AI Canvas Admin' },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        await service.appendAuditEvent({
          actor: session.admin,
          action: 'admin.mfa.setup_started',
          targetType: 'admin_user',
          targetId: session.admin.id,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        return {
          response: { totpUri: result.response.totpURI, recoveryCodes: result.response.backupCodes },
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async verifyTotp(input, context) {
      try {
        const code = validateCode(input.code, /^\d{6}$/, 'TOTP code is invalid')
        const result = await authApi.verifyTOTP({
          body: { code, trustDevice: false },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        const session = await getSessionByToken(pool, result.response.token)
        if (!session) throw new Error('Verified administrator session was not found')
        assertAdminAccess(session.admin)
        await service.appendAuditEvent({
          actor: session.admin,
          action: 'admin.mfa.totp_verified',
          targetType: 'admin_user',
          targetId: session.admin.id,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        return { response: session, setCookieHeaders: getSetCookieHeaders(result.headers) }
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async verifyRecoveryCode(input, context) {
      try {
        const code = validateCode(input.code, /^[a-z0-9-]{6,64}$/i, 'Recovery code is invalid')
        const result = await authApi.verifyBackupCode({
          body: { code, trustDevice: false, disableSession: false },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        if (!result.response.token) throw new Error('Recovery verification did not create a session')
        const session = await getSessionByToken(pool, result.response.token)
        if (!session) throw new Error('Verified administrator session was not found')
        assertAdminAccess(session.admin)
        await service.appendAuditEvent({
          actor: session.admin,
          action: 'admin.mfa.recovery_verified',
          targetType: 'admin_user',
          targetId: session.admin.id,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        return { response: session, setCookieHeaders: getSetCookieHeaders(result.headers) }
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async regenerateRecoveryCodes(input, context) {
      try {
        validatePassword(input.password)
        const session = await requireRawSession(pool, authApi, context)
        assertAdminAccess(session.admin)
        const result = await authApi.generateBackupCodes({
          body: { password: input.password },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        await service.appendAuditEvent({
          actor: session.admin,
          action: 'admin.mfa.recovery_regenerated',
          targetType: 'admin_user',
          targetId: session.admin.id,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        return {
          response: { recoveryCodes: result.response.backupCodes },
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw mapAuthError(error)
      }
    },

    async logout(context) {
      const secureAttribute = options.environment === 'production' || options.environment === 'staging' ? '; Secure' : ''
      const clearHeaders = ['session_token', 'session_data', 'dont_remember', 'two_factor', 'trust_device'].flatMap(
        (name) => ['', '__Secure-'].map((prefix) => `${prefix}${COOKIE_PREFIX}.${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`),
      )
      try {
        const result = await authApi.signOut({ headers: createRequestHeaders(context), returnHeaders: true })
        return {
          response: { success: true },
          setCookieHeaders: [...getSetCookieHeaders(result.headers), ...clearHeaders],
        }
      } catch {
        return { response: { success: true }, setCookieHeaders: clearHeaders }
      }
    },

    async requirePermission(context, permission) {
      const session = await service.getSession(context)
      assertAdminAccess(session.admin, permission)
      return session
    },

    async listAuditEvents(query, context) {
      await service.requirePermission(context, 'audit.read')
      const validated = validateAuditQuery(query)
      const values: unknown[] = []
      const clauses: string[] = []
      if (validated.cursor) {
        values.push(validated.cursor[0], validated.cursor[1])
        clauses.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`)
      }
      if (query.action) {
        values.push(query.action)
        clauses.push(`action = $${values.length}`)
      }
      if (query.result) {
        values.push(query.result)
        clauses.push(`result = $${values.length}`)
      }
      values.push(validated.limit + 1)
      const result = await pool.query<AdminAuditRow>(
        `
          SELECT id, admin_user_id, admin_role, action, target_type, target_id,
                 result, request_id, before_json, after_json, created_at
          FROM audit_events
          ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT $${values.length}
        `,
        values,
      )
      const hasMore = result.rows.length > validated.limit
      const items = result.rows.slice(0, validated.limit).map(toAuditEvent)
      return {
        items,
        nextCursor: hasMore && items.length > 0 ? encodeCursor(items.at(-1)!) : null,
      }
    },

    async appendAuditEvent(input) {
      if (!/^[a-z0-9_.:-]{1,96}$/i.test(input.action) || !/^.{1,128}$/.test(input.requestId)) {
        throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Audit event identifiers are invalid')
      }
      await pool.query(
        `
          INSERT INTO audit_events (
            admin_user_id, admin_role, action, target_type, target_id, result,
            request_id, ip_hash, user_agent_hash, before_json, after_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
        `,
        [
          input.actor?.id ?? null,
          input.actor?.role ?? null,
          input.action,
          input.targetType?.slice(0, 64) ?? null,
          input.targetId?.slice(0, 128) ?? null,
          input.result,
          input.requestId,
          hashAdminRequestIdentity(input.ipAddress, options.secret),
          hashAdminRequestIdentity(input.userAgent, options.secret),
          JSON.stringify(redactAdminAuditPayload(input.before)),
          JSON.stringify(redactAdminAuditPayload(input.after)),
        ],
      )
    },
  }

  return service
}

export async function bootstrapFirstSuperAdmin(
  pool: DbPool,
  options: PostgresAdminServiceOptions,
  input: { email: string; password: string; requestId: string },
) {
  const email = normalizeEmail(input.email)
  validatePassword(input.password)
  const authApi = options.authApi ?? createAdminBetterAuthApi(pool, options)
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [8_002_500_001])
    const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "user"')
    if (count.rows[0]?.count !== '0') {
      throw new AdminAccessError(409, 'ADMIN_ACCESS_DENIED', 'Administrator bootstrap has already been completed')
    }
    const result = await authApi.signUpEmail({
      body: { email, password: input.password, name: email.split('@')[0] || 'Administrator', rememberMe: false },
      returnHeaders: true,
    })
    await pool.query(
      `UPDATE "user" SET role = 'super_admin', status = 'active', email_verified = true, updated_at = now() WHERE id = $1`,
      [result.response.user.id],
    )
    await pool.query('DELETE FROM "session" WHERE user_id = $1', [result.response.user.id])
    const service = createPostgresAdminService(pool, { ...options, authApi })
    await service.appendAuditEvent({
      actor: { id: result.response.user.id, role: 'super_admin' },
      action: 'admin.bootstrap.completed',
      targetType: 'admin_user',
      targetId: result.response.user.id,
      result: 'success',
      requestId: input.requestId,
      after: { role: 'super_admin', status: 'active', email },
    })
    return { id: result.response.user.id, email, role: 'super_admin' as const }
  } catch (error) {
    throw mapAuthError(error)
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [8_002_500_001]).catch(() => undefined)
    lockClient.release()
  }
}
