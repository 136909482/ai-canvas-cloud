import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresPool, type DbPool } from '../../dist/db/postgres.js'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AdminAccessError } from '../../dist/modules/admin/security.js'
import {
  createAdminBetterAuthApi,
  createPostgresAdminService,
  hashAdminCaptchaCode,
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

test('real Admin Better Auth supports password login, optional one-time CAPTCHA, credential changes, bans, and session revocation', {
  skip: databaseUrl && testOptions ? false : 'ADMIN_DATABASE_URL and ADMIN_BETTER_AUTH_SECRET are not configured',
}, async () => {
  const pool = createPostgresPool({ connectionString: databaseUrl!, schema: 'admin' })
  const authApi = createAdminBetterAuthApi(pool, testOptions!)
  const service = createPostgresAdminService(pool, { ...testOptions!, authApi })
  const id = randomUUID()
  let username = `adm_${id.replaceAll('-', '').slice(0, 20)}`
  const email = `admin-login-${id}@example.invalid`
  let password = `Admin-Login-${id}!`
  let userId: string | null = null
  let stage = 'register'
  try {
    const registered = await authApi.signUpEmail({
      body: { email, password, name: 'Login Integration Admin', username, displayUsername: username, rememberMe: false },
      returnHeaders: true,
    })
    userId = registered.response.user.id
    await pool.query(`UPDATE "user" SET role = 'super_admin', email_verified = true WHERE id = $1`, [userId])
    await pool.query('DELETE FROM "session" WHERE user_id = $1', [userId])
    await pool.query(`UPDATE login_security_settings SET captcha_enabled = false, updated_by_admin_id = NULL WHERE singleton_id = 1`)
    stage = 'password_login'
    const loggedIn = await service.login({ username, password }, { requestId: `login-${id}` })
    assert.equal(loggedIn.response.state, 'authenticated')
    let sessionCookie = loggedIn.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    const session = await service.getSession({ requestId: `session-${id}`, cookieHeader: sessionCookie })
    assert.equal(session.admin.role, 'super_admin')
    assert.equal(session.admin.username, username)

    stage = 'update_username'
    const nextUsername = `ops_${id.replaceAll('-', '').slice(0, 20)}`
    const renamed = await service.updateUsername({ username: nextUsername }, { requestId: `username-${id}`, cookieHeader: sessionCookie })
    assert.equal(renamed.admin.username, nextUsername)
    username = nextUsername

    stage = 'change_password'
    const nextPassword = `Changed-Admin-${id}!`
    const changed = await service.changePassword({ currentPassword: password, newPassword: nextPassword }, { requestId: `password-${id}`, cookieHeader: sessionCookie })
    assert.equal(changed.response.admin.username, username)
    sessionCookie = changed.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    password = nextPassword

    stage = 'enable_captcha'
    const enabled = await service.updateLoginSecuritySettings({ captchaEnabled: true }, { requestId: `captcha-on-${id}`, cookieHeader: sessionCookie })
    assert.equal(enabled.captchaEnabled, true)
    const generated = await service.createLoginCaptcha()
    assert.equal(generated.enabled, true)
    assert.match(generated.challenge?.id ?? '', /^[0-9a-f-]{36}$/)
    assert.match(generated.challenge?.imageDataUrl ?? '', /^data:image\/svg\+xml;base64,/)

    stage = 'reject_bad_captcha'
    await assert.rejects(
      () => service.login({ username, password, captchaChallengeId: generated.challenge!.id, captchaCode: '00000' }, { requestId: `captcha-bad-${id}` }),
      (error) => error instanceof AdminAccessError && error.code === 'VALIDATION_FAILED',
    )

    const challengeId = randomUUID()
    const challengeCode = '31415'
    await pool.query(`
      INSERT INTO login_captcha_challenges (id, code_hash, expires_at)
      VALUES ($1, $2, now() + interval '5 minutes')
    `, [challengeId, hashAdminCaptchaCode(testOptions!.secret, challengeId, challengeCode)])
    stage = 'login_with_captcha'
    const captchaLogin = await service.login({ username, password, captchaChallengeId: challengeId, captchaCode: challengeCode }, { requestId: `captcha-login-${id}` })
    assert.equal(captchaLogin.response.state, 'authenticated')
    assert.equal((await pool.query('SELECT consumed_at IS NOT NULL AS consumed FROM login_captcha_challenges WHERE id = $1', [challengeId])).rows[0]?.consumed, true)
    await assert.rejects(
      () => service.login({ username, password, captchaChallengeId: challengeId, captchaCode: challengeCode }, { requestId: `captcha-reuse-${id}` }),
      (error) => error instanceof AdminAccessError && error.code === 'VALIDATION_FAILED',
    )

    sessionCookie = captchaLogin.setCookieHeaders.map((value) => value.split(';')[0]).join('; ')
    stage = 'disable_captcha'
    const disabled = await service.updateLoginSecuritySettings({ captchaEnabled: false }, { requestId: `captcha-off-${id}`, cookieHeader: sessionCookie })
    assert.equal(disabled.captchaEnabled, false)
    assert.equal((await service.createLoginCaptcha()).challenge, null)
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE action = 'admin.security.captcha_updated' AND admin_user_id = $1`, [userId])).rows[0]?.count >= 2, true)

    await pool.query('DELETE FROM "session" WHERE user_id = $1', [userId])
    await assert.rejects(
      () => service.getSession({ requestId: `revoked-${id}`, cookieHeader: sessionCookie }),
      (error) => error instanceof AdminAccessError && error.code === 'AUTH_REQUIRED',
    )

    await pool.query(`UPDATE "user" SET status = 'banned' WHERE id = $1`, [userId])
    await assert.rejects(
      () => service.login({ username, password }, { requestId: `banned-${id}` }),
      (error) => error instanceof AdminAccessError && error.code === 'ADMIN_ACCESS_DENIED',
    )
  } catch (error) {
    throw new Error(`Admin login integration failed at ${stage}`, { cause: error })
  } finally {
    await pool.query(`UPDATE login_security_settings SET captcha_enabled = false, updated_by_admin_id = NULL WHERE singleton_id = 1`).catch(() => undefined)
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
