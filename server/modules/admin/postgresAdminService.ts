import { createHash, randomInt, randomUUID } from 'node:crypto'
import { APIError, betterAuth } from 'better-auth'
import { splitSetCookieHeader } from 'better-auth/cookies'
import { username } from 'better-auth/plugins'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { withTransaction } from '../../db/postgres.js'
import { insertAdminAuditEvent } from './adminAudit.js'
import { AdminAccessError, assertAdminAccess, safeTokenEqual } from './security.js'
import type { AdminAuditQuery, AdminService } from './service.js'
import { ADMIN_ROLES, type AdminAuditEvent, type AdminPrincipal, type AdminRequestContext, type AdminRole, type AdminSession } from './types.js'

const COOKIE_PREFIX = 'ai_canvas_admin'
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const CAPTCHA_TTL_SECONDS = 5 * 60
const CAPTCHA_LENGTH = 5
const CAPTCHA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  username?: unknown
  role?: unknown
  status?: unknown
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
    body: { email: string; password: string; name: string; username?: string; displayUsername?: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>
  signInUsername(input: {
    body: { username: string; password: string; rememberMe?: boolean }
    headers?: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token: string; user: BetterAuthUser }>>
  getSession(input: {
    headers: Headers
    query?: { disableCookieCache?: boolean; disableRefresh?: boolean }
  }): Promise<{ session: BetterAuthSession; user: BetterAuthUser } | null>
  changePassword(input: {
    body: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ token: string | null; user: BetterAuthUser }>>
  signOut(input: {
    headers: Headers
    returnHeaders?: boolean
  }): Promise<EndpointResult<{ success: boolean }>>
}

interface AdminUserRow {
  id: string
  username: string
  role: AdminRole
  status: 'active' | 'banned'
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
    username: row.username,
    role: parseRole(row.role),
    status: row.status,
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

function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9_.]{3,30}$/.test(normalized)) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator username must be 3 to 30 letters, numbers, underscores, or dots')
  }
  return normalized
}

interface LoginSecuritySettingRow {
  captcha_enabled: boolean
  updated_at: Date | string
}

interface LoginCaptchaRow {
  code_hash: string
  failed_attempts: number
  expires_at: Date | string
  consumed_at: Date | string | null
}

const CAPTCHA_DIGITS: Readonly<Record<string, readonly string[]>> = {
  '0': ['11111', '10001', '10011', '10101', '11001', '10001', '11111'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
}

function validateNewPassword(value: string) {
  if (value.length < 12 || value.length > 256) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator password must be 12 to 256 characters')
  }
}

function validateCurrentPassword(value: string) {
  if (value.length < 1 || value.length > 256) {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator password is invalid')
  }
}

function validateBootstrapPassword(value: string, environment: string) {
  if (environment === 'development' && value.length >= 5 && value.length <= 256) return
  validateNewPassword(value)
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

export function hashAdminCaptchaCode(secret: string, challengeId: string, code: string) {
  return createHash('sha256').update(secret).update('\0').update(challengeId).update('\0').update(code).digest('hex')
}

function createCaptchaCode() {
  return Array.from({ length: CAPTCHA_LENGTH }, () => String(randomInt(0, 10))).join('')
}

function renderCaptchaSvg(code: string) {
  const colors = ['#173c2b', '#244d38', '#315f47', '#49705a']
  const shapes: string[] = []
  for (let index = 0; index < code.length; index += 1) {
    const rows = CAPTCHA_DIGITS[code[index]!]!
    const originX = 10 + index * 31
    const angle = randomInt(-7, 8)
    const pixels: string[] = []
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < rows[row]!.length; column += 1) {
        if (rows[row]![column] === '1') {
          pixels.push(`<rect x="${originX + column * 5}" y="${10 + row * 6}" width="4" height="5" rx="1"/>`)
        }
      }
    }
    shapes.push(`<g fill="${colors[randomInt(0, colors.length)]}" transform="rotate(${angle} ${originX + 12} 31)">${pixels.join('')}</g>`)
  }
  const noise = Array.from({ length: 7 }, () => {
    const y1 = randomInt(5, 55)
    const y2 = randomInt(5, 55)
    return `<path d="M0 ${y1} C45 ${randomInt(0, 60)}, 110 ${randomInt(0, 60)}, 170 ${y2}" fill="none" stroke="${colors[randomInt(0, colors.length)]}" stroke-opacity="0.2" stroke-width="1"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="60" viewBox="0 0 170 60"><rect width="170" height="60" rx="4" fill="#edf1ee"/>${noise}${shapes.join('')}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function readLoginSecuritySetting(database: Pick<DbPool | DbClient, 'query'>) {
  const result = await database.query<LoginSecuritySettingRow>(`
    SELECT captcha_enabled, updated_at
    FROM login_security_settings
    WHERE singleton_id = 1
  `)
  const row = result.rows[0]
  if (!row) throw new AdminAccessError(503, 'SERVICE_UNAVAILABLE', 'Administrator login security settings are unavailable')
  return row
}

async function verifyLoginCaptcha(
  pool: DbPool,
  secret: string,
  input: { captchaChallengeId?: string; captchaCode?: string },
) {
  const valid = await withTransaction(pool, async (client) => {
    const setting = await readLoginSecuritySetting(client)
    if (!setting.captcha_enabled) return true
    const challengeId = input.captchaChallengeId?.trim().toLowerCase()
    const code = input.captchaCode?.trim()
    if (!challengeId || !CAPTCHA_ID_PATTERN.test(challengeId) || !code || !/^\d{5}$/.test(code)) return false
    const challenge = await client.query<LoginCaptchaRow>(`
      SELECT code_hash, failed_attempts, expires_at, consumed_at
      FROM login_captcha_challenges
      WHERE id = $1
      FOR UPDATE
    `, [challengeId])
    const row = challenge.rows[0]
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() || row.failed_attempts >= 5) {
      return false
    }
    const matches = safeTokenEqual(row.code_hash, hashAdminCaptchaCode(secret, challengeId, code))
    if (matches) {
      await client.query('UPDATE login_captcha_challenges SET consumed_at = now() WHERE id = $1', [challengeId])
      return true
    }
    await client.query(`
      UPDATE login_captcha_challenges
      SET failed_attempts = LEAST(failed_attempts + 1, 5),
          consumed_at = CASE WHEN failed_attempts + 1 >= 5 THEN now() ELSE consumed_at END
      WHERE id = $1
    `, [challengeId])
    return false
  })
  if (!valid) throw new AdminAccessError(400, 'VALIDATION_FAILED', 'Administrator CAPTCHA is invalid or expired')
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
      minPasswordLength: options.environment === 'development' ? 5 : 12,
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
    plugins: [username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/.test(value),
      schema: { user: { fields: { username: 'username', displayUsername: 'display_username' } } },
    })],
    rateLimit: { enabled: options.environment !== 'test', window: 60, max: 10 },
    advanced: cookieSecurityOptions(options.environment),
  })
  return auth.api as unknown as AdminBetterAuthApi
}

async function findAdminByUsername(pool: DbPool, usernameValue: string) {
  const result = await pool.query<AdminUserRow>(
    'SELECT id, username, role, status FROM "user" WHERE username = $1',
    [usernameValue],
  )
  return result.rows[0] ?? null
}

async function getSessionByToken(pool: DbPool, token: string) {
  const result = await pool.query<AdminSessionRow>(
    `
      SELECT u.id, u.username, u.role, u.status, s.expires_at
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
    async createLoginCaptcha() {
      const id = randomUUID()
      const code = createCaptchaCode()
      const expiresAt = new Date(Date.now() + CAPTCHA_TTL_SECONDS * 1000)
      return withTransaction(pool, async (client) => {
        const setting = await client.query<LoginSecuritySettingRow>(`
          SELECT captcha_enabled, updated_at
          FROM login_security_settings
          WHERE singleton_id = 1
          FOR SHARE
        `)
        const row = setting.rows[0]
        if (!row) throw new AdminAccessError(503, 'SERVICE_UNAVAILABLE', 'Administrator login security settings are unavailable')
        if (!row.captcha_enabled) return { enabled: false, challenge: null }
        await client.query(`
          DELETE FROM login_captcha_challenges
          WHERE expires_at < now() - interval '1 day'
             OR consumed_at < now() - interval '1 day'
        `)
        await client.query(`
          INSERT INTO login_captcha_challenges (id, code_hash, expires_at)
          VALUES ($1, $2, $3)
        `, [id, hashAdminCaptchaCode(options.secret, id, code), expiresAt])
        return {
          enabled: true,
          challenge: { id, imageDataUrl: renderCaptchaSvg(code), expiresAt: expiresAt.toISOString() },
        }
      })
    },

    async login(input, context) {
      try {
        await verifyLoginCaptcha(pool, options.secret, input)
        const usernameValue = normalizeUsername(input.username)
        validateCurrentPassword(input.password)
        const existing = await findAdminByUsername(pool, usernameValue)
        if (existing?.status === 'banned') {
          throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator access is disabled')
        }
        const result = await authApi.signInUsername({
          body: { username: usernameValue, password: input.password, rememberMe: false },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        const session = await getSessionByToken(pool, result.response.token)
        if (!session) throw new Error('Created administrator session was not found')
        return {
          response: { state: 'authenticated', session },
          setCookieHeaders: getSetCookieHeaders(result.headers),
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

    async getLoginSecuritySettings(context) {
      await service.requirePermission(context, 'security.write')
      const setting = await readLoginSecuritySetting(pool)
      return { captchaEnabled: setting.captcha_enabled, updatedAt: new Date(setting.updated_at).toISOString() }
    },

    async updateLoginSecuritySettings(input, context) {
      if (typeof input.captchaEnabled !== 'boolean') {
        throw new AdminAccessError(400, 'VALIDATION_FAILED', 'captchaEnabled must be a boolean')
      }
      const session = await service.requirePermission(context, 'security.write')
      return withTransaction(pool, async (client) => {
        const before = await client.query<LoginSecuritySettingRow>(`
          SELECT captcha_enabled, updated_at
          FROM login_security_settings
          WHERE singleton_id = 1
          FOR UPDATE
        `)
        const current = before.rows[0]
        if (!current) throw new AdminAccessError(503, 'SERVICE_UNAVAILABLE', 'Administrator login security settings are unavailable')
        const updated = await client.query<LoginSecuritySettingRow>(`
          UPDATE login_security_settings
          SET captcha_enabled = $1, updated_by_admin_id = $2, updated_at = now()
          WHERE singleton_id = 1
          RETURNING captcha_enabled, updated_at
        `, [input.captchaEnabled, session.admin.id])
        if (!input.captchaEnabled) {
          await client.query(`
            UPDATE login_captcha_challenges
            SET consumed_at = now()
            WHERE consumed_at IS NULL
          `)
        }
        await insertAdminAuditEvent(client, {
          actor: session.admin,
          action: 'admin.security.captcha_updated',
          targetType: 'admin_login_security',
          targetId: 'singleton',
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          before: { captchaEnabled: current.captcha_enabled },
          after: { captchaEnabled: input.captchaEnabled },
        }, options.secret)
        const row = updated.rows[0]!
        return { captchaEnabled: row.captcha_enabled, updatedAt: new Date(row.updated_at).toISOString() }
      })
    },

    async logout(context) {
      const secureAttribute = options.environment === 'production' || options.environment === 'staging' ? '; Secure' : ''
      const clearHeaders = ['session_token', 'session_data', 'dont_remember'].flatMap(
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
      try {
        await insertAdminAuditEvent(pool, input, options.secret)
      } catch (error) {
        if (error instanceof AdminAccessError) throw error
        if (error instanceof Error && error.message === 'Audit event identifiers are invalid') {
          throw new AdminAccessError(400, 'VALIDATION_FAILED', error.message)
        }
        throw error
      }
    },

    async updateUsername(input, context) {
      try {
        const usernameValue = normalizeUsername(input.username)
        const session = await requireRawSession(pool, authApi, context)
        assertAdminAccess(session.admin)
        if (session.admin.username === usernameValue) return session
        await withTransaction(pool, async (client) => {
          const updated = await client.query<{ username: string }>(`
            UPDATE "user"
            SET username = $1, display_username = $1, updated_at = now()
            WHERE id = $2
            RETURNING username
          `, [usernameValue, session.admin.id])
          if (!updated.rows[0]) throw new AdminAccessError(401, 'AUTH_REQUIRED', 'Administrator session is missing or expired')
          await insertAdminAuditEvent(client, {
            actor: session.admin,
            action: 'admin.credentials.username_changed',
            targetType: 'admin_user',
            targetId: session.admin.id,
            result: 'success',
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: { username: session.admin.username },
            after: { username: usernameValue },
          }, options.secret)
        })
        return { ...session, admin: { ...session.admin, username: usernameValue } }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          throw new AdminAccessError(409, 'VALIDATION_FAILED', 'Administrator username is already in use')
        }
        throw mapAuthError(error)
      }
    },

    async changePassword(input, context) {
      try {
        validateCurrentPassword(input.currentPassword)
        validateNewPassword(input.newPassword)
        const session = await requireRawSession(pool, authApi, context)
        assertAdminAccess(session.admin)
        const result = await authApi.changePassword({
          body: {
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            revokeOtherSessions: true,
          },
          headers: createRequestHeaders(context),
          returnHeaders: true,
        })
        if (!result.response.token) throw new Error('Password change did not rotate the administrator session')
        const updatedSession = await getSessionByToken(pool, result.response.token)
        if (!updatedSession) throw new Error('Rotated administrator session was not found')
        await service.appendAuditEvent({
          actor: session.admin,
          action: 'admin.credentials.password_changed',
          targetType: 'admin_user',
          targetId: session.admin.id,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after: { otherSessionsRevoked: true },
        })
        return {
          response: updatedSession,
          setCookieHeaders: getSetCookieHeaders(result.headers),
        }
      } catch (error) {
        throw mapAuthError(error)
      }
    },
  }

  return service
}

export async function bootstrapFirstSuperAdmin(
  pool: DbPool,
  options: PostgresAdminServiceOptions,
  input: { username: string; password: string; requestId: string },
) {
  const usernameValue = normalizeUsername(input.username)
  validateBootstrapPassword(input.password, options.environment)
  const internalEmail = `${usernameValue}@admin.invalid`
  const authApi = options.authApi ?? createAdminBetterAuthApi(pool, options)
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [8_002_500_001])
    const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "user"')
    if (count.rows[0]?.count !== '0') {
      throw new AdminAccessError(409, 'ADMIN_ACCESS_DENIED', 'Administrator bootstrap has already been completed')
    }
    const result = await authApi.signUpEmail({
      body: {
        email: internalEmail,
        password: input.password,
        name: usernameValue,
        username: usernameValue,
        displayUsername: usernameValue,
        rememberMe: false,
      },
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
      after: { role: 'super_admin', status: 'active', username: usernameValue },
    })
    return { id: result.response.user.id, username: usernameValue, role: 'super_admin' as const }
  } catch (error) {
    throw mapAuthError(error)
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [8_002_500_001]).catch(() => undefined)
    lockClient.release()
  }
}
