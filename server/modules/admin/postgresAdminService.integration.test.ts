import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { base32 } from '@better-auth/utils/base32'
import { splitSetCookieHeader } from 'better-auth/cookies'
import { createPostgresPool, type DbPool } from '../../dist/db/postgres.js'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AdminAccessError } from '../../dist/modules/admin/security.js'
import {
  createAdminBetterAuthApi,
  createPostgresAdminService,
  type AdminBetterAuthApi,
} from '../../dist/modules/admin/postgresAdminService.js'

loadDotEnv()
const databaseUrl = process.env.ADMIN_DATABASE_URL
const authSecret = process.env.ADMIN_BETTER_AUTH_SECRET
const testOptions = authSecret ? {
  baseURL: 'http://127.0.0.1:18788',
  secret: authSecret,
  trustedOrigins: ['http://127.0.0.1:15174'],
  environment: 'test',
  issuer: 'AI Canvas Admin Test',
} : null

function cookies(headers: Headers) {
  const values = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : splitSetCookieHeader(headers.get('set-cookie') ?? '')
  return values.map((value) => value.split(';')[0]).join('; ')
}

test('real Admin Better Auth enforces TOTP, one-time recovery codes, bans, and session revocation', {
  skip: databaseUrl && testOptions ? false : 'ADMIN_DATABASE_URL and ADMIN_BETTER_AUTH_SECRET are not configured',
}, async () => {
  const pool = createPostgresPool({ connectionString: databaseUrl!, schema: 'admin' })
  const authApi = createAdminBetterAuthApi(pool, testOptions!)
  const service = createPostgresAdminService(pool, { ...testOptions!, authApi })
  const id = randomUUID()
  const email = `admin-mfa-${id}@example.invalid`
  const password = `Admin-Mfa-${id}!`
  let userId: string | null = null
  let stage = 'register'
  try {
    const registered = await authApi.signUpEmail({
      body: { email, password, name: 'MFA Integration Admin', rememberMe: false },
      returnHeaders: true,
    })
    userId = registered.response.user.id
    await pool.query(`UPDATE "user" SET role = 'super_admin', email_verified = true WHERE id = $1`, [userId])
    let sessionCookie = cookies(registered.headers)
    stage = 'enable_totp'
    const setup = await authApi.enableTwoFactor({
      body: { password, issuer: 'AI Canvas Admin Test' },
      headers: new Headers({ cookie: sessionCookie }),
      returnHeaders: true,
    })
    assert.equal(setup.response.backupCodes.length > 0, true)
    const secret = new URL(setup.response.totpURI).searchParams.get('secret')
    assert(secret)
    const rawSecret = new TextDecoder().decode(base32.decode(secret))
    stage = 'verify_initial_totp'
    const firstCode = await authApi.generateTOTP({ body: { secret: rawSecret } })
    const enabled = await authApi.verifyTOTP({
      body: { code: firstCode.code, trustDevice: false },
      headers: new Headers({ cookie: sessionCookie }),
      returnHeaders: true,
    })
    sessionCookie = cookies(enabled.headers)
    assert.equal((await pool.query('SELECT two_factor_enabled FROM "user" WHERE id = $1', [userId])).rows[0]?.two_factor_enabled, true)

    await pool.query('DELETE FROM "session" WHERE user_id = $1', [userId])
    stage = 'login_totp_challenge'
    const challenge = await service.login({ email, password }, { requestId: `login-${id}` })
    assert.equal(challenge.response.state, 'mfa_required')
    const challengeCookie = challenge.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    const nextCode = await authApi.generateTOTP({ body: { secret: rawSecret } })
    stage = 'verify_login_totp'
    const verified = await authApi.verifyTOTP({
      body: { code: nextCode.code, trustDevice: false },
      headers: new Headers({ cookie: challengeCookie }),
      returnHeaders: true,
    })
    sessionCookie = cookies(verified.headers)
    const session = await service.getSession({ requestId: `session-${id}`, cookieHeader: sessionCookie })
    assert.equal(session.admin.role, 'super_admin')

    await pool.query('DELETE FROM "session" WHERE user_id = $1', [userId])
    await assert.rejects(
      () => service.getSession({ requestId: `revoked-${id}`, cookieHeader: sessionCookie }),
      (error) => error instanceof AdminAccessError && error.code === 'AUTH_REQUIRED',
    )

    stage = 'login_recovery_challenge'
    const recoveryChallenge = await service.login({ email, password }, { requestId: `recovery-login-${id}` })
    const recoveryCookie = recoveryChallenge.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    stage = 'verify_recovery_code'
    const recovered = await authApi.verifyBackupCode({
      body: { code: setup.response.backupCodes[0]!, trustDevice: false, disableSession: false },
      headers: new Headers({ cookie: recoveryCookie }),
      returnHeaders: true,
    })
    sessionCookie = cookies(recovered.headers)
    await pool.query(`UPDATE "user" SET status = 'banned' WHERE id = $1`, [userId])
    await assert.rejects(
      () => service.getSession({ requestId: `banned-${id}`, cookieHeader: sessionCookie }),
      (error) => error instanceof AdminAccessError && error.code === 'ADMIN_ACCESS_DENIED',
    )

    await pool.query(`UPDATE "user" SET status = 'active' WHERE id = $1`, [userId])
    await pool.query('DELETE FROM "session" WHERE user_id = $1', [userId])
    stage = 'verify_recovery_reuse'
    const reusedChallenge = await service.login({ email, password }, { requestId: `reuse-login-${id}` })
    const reusedCookie = reusedChallenge.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    await assert.rejects(() => authApi.verifyBackupCode({
      body: { code: setup.response.backupCodes[0]!, trustDevice: false, disableSession: false },
      headers: new Headers({ cookie: reusedCookie }),
      returnHeaders: true,
    }))
  } catch (error) {
    throw new Error(`Admin MFA integration failed at ${stage}`, { cause: error })
  } finally {
    if (userId) await pool.query(`UPDATE "user" SET status = 'active' WHERE id = $1`, [userId]).catch(() => undefined)
    if (userId) await pool.query('DELETE FROM "user" WHERE id = $1', [userId]).catch(() => undefined)
    await pool.end()
  }
})

test('Admin runtime role appends redacted audit events but cannot update or delete them', {
  skip: databaseUrl && testOptions ? false : 'ADMIN_DATABASE_URL and ADMIN_BETTER_AUTH_SECRET are not configured',
}, async () => {
  const pool = createPostgresPool({ connectionString: databaseUrl!, schema: 'admin' })
  const client = await pool.connect()
  const requestId = `audit-integration-${randomUUID()}`
  const unavailableAuth = {} as AdminBetterAuthApi
  const service = createPostgresAdminService(client as unknown as DbPool, { ...testOptions!, authApi: unavailableAuth })
  try {
    await client.query('BEGIN')
    await service.appendAuditEvent({
      action: 'admin.audit.integration_checked',
      result: 'success',
      requestId,
      ipAddress: '192.0.2.30',
      userAgent: 'Integration Test Agent',
      before: { apiKey: 'sk-before-secret', prompt: 'private prompt' },
      after: { status: 'active', authorization: 'Bearer after-secret', endpoint: 'https://example.com/private?token=secret' },
    })
    const stored = await client.query(`
      SELECT id, ip_hash, user_agent_hash, before_json, after_json
      FROM audit_events
      WHERE request_id = $1
    `, [requestId])
    assert.equal(stored.rowCount, 1)
    assert.match(stored.rows[0]?.ip_hash, /^[0-9a-f]{64}$/)
    assert.match(stored.rows[0]?.user_agent_hash, /^[0-9a-f]{64}$/)
    const serialized = JSON.stringify([stored.rows[0]?.before_json, stored.rows[0]?.after_json])
    assert.doesNotMatch(serialized, /sk-before-secret|private prompt|after-secret|token=secret/)
    assert.equal(stored.rows[0]?.after_json.endpoint, 'https://example.com')

    await client.query('SAVEPOINT immutable_update')
    await assert.rejects(() => client.query('UPDATE audit_events SET result = \'failure\' WHERE id = $1', [stored.rows[0]?.id]))
    await client.query('ROLLBACK TO SAVEPOINT immutable_update')
    await client.query('RELEASE SAVEPOINT immutable_update')
    await client.query('SAVEPOINT immutable_delete')
    await assert.rejects(() => client.query('DELETE FROM audit_events WHERE id = $1', [stored.rows[0]?.id]))
    await client.query('ROLLBACK TO SAVEPOINT immutable_delete')
    await client.query('RELEASE SAVEPOINT immutable_delete')
    await client.query('ROLLBACK')
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
    await pool.end()
  }
})
