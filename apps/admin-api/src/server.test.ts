import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { DEFAULT_SITE_CONFIG } from '@ai-canvas-cloud/contracts'
import { AdminAccessError, createUnavailableAdminService, type AdminService, type AdminSiteConfigService } from '@ai-canvas-cloud/server/modules/admin'
import { createAdminApiServer } from './server.ts'

const config = {
  env: 'development', host: '127.0.0.1', port: 8788, logLevel: 'error' as const,
  shutdownTimeoutMs: 1_000, trustProxy: false,
  databaseUrl: 'postgres://admin_role@localhost/cloud',
  betterAuthUrl: 'http://127.0.0.1:8788',
  betterAuthSecret: 'admin-secret-that-is-long-enough-for-tests',
  webPublicUrl: 'http://localhost:5174',
  allowedOrigins: ['http://localhost:5174'],
  s3Endpoint: 'http://localhost:9000', s3PublicEndpoint: 'http://localhost:9000',
  s3Bucket: 'test', s3Region: 'us-east-1', s3AccessKeyId: 'test', s3SecretAccessKey: 'test',
}

const logger = { debug() {}, info() {}, warn() {}, error() {} }

function request(port: number, options: { path: string; method?: string; origin?: string; cookie?: string; csrf?: string; body?: unknown }) {
  return new Promise<{ status: number; body: Record<string, unknown>; cookies: string[] }>((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.origin) headers.origin = options.origin
    if (options.cookie) headers.cookie = options.cookie
    if (options.csrf) headers['x-csrf-token'] = options.csrf
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(body)) }
    const req = http.request({ hostname: '127.0.0.1', port, path: options.path, method: options.method ?? 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        cookies: res.headers['set-cookie'] ?? [],
      }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function withServer(service: AdminService, operation: (port: number) => Promise<void>, siteConfigService?: AdminSiteConfigService) {
  const server = createAdminApiServer({ config, adminService: service, siteConfigService, logger })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  try { await operation(address.port) }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function csrf(port: number) {
  const result = await request(port, { path: '/admin/v1/auth/csrf', origin: config.allowedOrigins[0] })
  assert.equal(result.status, 200)
  const token = result.body.token
  assert.equal(typeof token, 'string')
  return { token: token as string, cookie: result.cookies[0]!.split(';')[0]! }
}

test('Admin API enforces CSRF before calling login service', async () => {
  let loginCalls = 0
  let loginInput: unknown
  const service = { ...createUnavailableAdminService(), async login(input: unknown) {
    loginCalls += 1
    loginInput = input
    return {
      response: {
        state: 'authenticated' as const,
        session: { admin: { id: 'admin-1', username: 'admin', role: 'super_admin' as const, status: 'active' as const }, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      },
      setCookieHeaders: [],
    }
  } }
  await withServer(service, async (port) => {
    const rejected = await request(port, { path: '/admin/v1/auth/login', method: 'POST', origin: config.allowedOrigins[0], body: { username: 'admin', password: 'password-long-enough' } })
    assert.equal(rejected.status, 403)
    assert.equal(loginCalls, 0)
    const token = await csrf(port)
    const accepted = await request(port, { path: '/admin/v1/auth/login', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { username: 'admin', password: 'password-long-enough', captchaChallengeId: 'challenge-id', captchaCode: '31415' } })
    assert.equal(accepted.status, 200)
    assert.equal(loginCalls, 1)
    assert.deepEqual(loginInput, { username: 'admin', password: 'password-long-enough', captchaChallengeId: 'challenge-id', captchaCode: '31415' })
  })
})

test('Admin CAPTCHA is public while login security settings stay authenticated and CSRF protected', async () => {
  const calls: unknown[] = []
  const service = {
    ...createUnavailableAdminService(),
    async createLoginCaptcha() { return { enabled: true, challenge: { id: 'captcha-id', imageDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: new Date(Date.now() + 60_000).toISOString() } } },
    async getLoginSecuritySettings() { return { captchaEnabled: true, updatedAt: new Date().toISOString() } },
    async updateLoginSecuritySettings(input: unknown) { calls.push(input); return { captchaEnabled: false, updatedAt: new Date().toISOString() } },
  }
  await withServer(service, async (port) => {
    const captcha = await request(port, { path: '/admin/v1/auth/captcha', origin: config.allowedOrigins[0] })
    assert.equal(captcha.status, 200)
    assert.equal(captcha.body.enabled, true)
    const settings = await request(port, { path: '/admin/v1/auth/login-security', origin: config.allowedOrigins[0] })
    assert.equal(settings.status, 200)
    assert.equal(settings.body.captchaEnabled, true)
    const rejected = await request(port, { path: '/admin/v1/auth/login-security', method: 'POST', origin: config.allowedOrigins[0], body: { captchaEnabled: false } })
    assert.equal(rejected.status, 403)
    const token = await csrf(port)
    const updated = await request(port, { path: '/admin/v1/auth/login-security', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { captchaEnabled: false } })
    assert.equal(updated.status, 200)
    assert.deepEqual(calls, [{ captchaEnabled: false }])
  })
})

test('Admin credential routes require CSRF and forward username and password changes', async () => {
  const session = {
    admin: { id: 'admin-1', username: 'admin', role: 'super_admin' as const, status: 'active' as const },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  const calls: unknown[] = []
  const service = {
    ...createUnavailableAdminService(),
    async updateUsername(input: unknown) { calls.push(input); return { ...session, admin: { ...session.admin, username: 'operator' } } },
    async changePassword(input: unknown) { calls.push(input); return { response: session, setCookieHeaders: ['changed=1; Path=/; HttpOnly'] } },
  }
  await withServer(service, async (port) => {
    const rejected = await request(port, { path: '/admin/v1/auth/username', method: 'POST', origin: config.allowedOrigins[0], body: { username: 'operator' } })
    assert.equal(rejected.status, 403)
    const token = await csrf(port)
    const renamed = await request(port, { path: '/admin/v1/auth/username', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { username: 'operator' } })
    assert.equal(renamed.status, 200)
    assert.equal((renamed.body.admin as { username: string }).username, 'operator')
    const password = await request(port, { path: '/admin/v1/auth/password', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { currentPassword: 'admin', newPassword: 'changed-password' } })
    assert.equal(password.status, 200)
    assert.equal(password.cookies.some((value) => value.startsWith('changed=1')), true)
    assert.deepEqual(calls, [{ username: 'operator' }, { currentPassword: 'admin', newPassword: 'changed-password' }])
  })
})

test('Admin API rejects banned, revoked, and role-mismatched sessions with stable codes', async () => {
  const banned = { ...createUnavailableAdminService(), async getSession() { throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator access is disabled') } }
  await withServer(banned, async (port) => {
    const result = await request(port, { path: '/admin/v1/auth/session', origin: config.allowedOrigins[0] })
    assert.equal(result.status, 403)
    assert.equal((result.body.error as { code: string }).code, 'ADMIN_ACCESS_DENIED')
  })
  const revoked = { ...createUnavailableAdminService(), async getSession() { throw new AdminAccessError(401, 'AUTH_REQUIRED', 'Administrator session is missing or expired') } }
  await withServer(revoked, async (port) => {
    const result = await request(port, { path: '/admin/v1/auth/session', origin: config.allowedOrigins[0] })
    assert.equal(result.status, 401)
    assert.equal((result.body.error as { code: string }).code, 'AUTH_REQUIRED')
  })
  const mismatched = { ...createUnavailableAdminService(), async listAuditEvents() { throw new AdminAccessError(403, 'ADMIN_ACCESS_DENIED', 'Administrator role is not permitted') } }
  await withServer(mismatched, async (port) => {
    const result = await request(port, { path: '/admin/v1/audit-events', origin: config.allowedOrigins[0] })
    assert.equal(result.status, 403)
    assert.equal((result.body.error as { code: string }).code, 'ADMIN_ACCESS_DENIED')
  })
})

test('Admin site configuration routes keep reads behind administrator sessions and writes behind CSRF', async () => {
  let publishCalls = 0
  const siteConfigService: AdminSiteConfigService = {
    async getCurrent() { return { etag: `"${'a'.repeat(64)}"`, config: DEFAULT_SITE_CONFIG, assets: { logo: null, favicon: null }, revision: null } },
    async publish() { publishCalls += 1; return this.getCurrent({ requestId: 'test' }) },
    async listAssets() { return { items: [] } },
    async createAsset() { throw new Error('not used') },
    async completeAsset() { throw new Error('not used') },
  }
  await withServer(createUnavailableAdminService(), async (port) => {
    const read = await request(port, { path: '/admin/v1/site-config', origin: config.allowedOrigins[0] })
    assert.equal(read.status, 200)
    const rejected = await request(port, { path: '/admin/v1/site-config', method: 'POST', origin: config.allowedOrigins[0], body: { config: DEFAULT_SITE_CONFIG } })
    assert.equal(rejected.status, 403)
    assert.equal(publishCalls, 0)
    const token = await csrf(port)
    const published = await request(port, { path: '/admin/v1/site-config', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { config: DEFAULT_SITE_CONFIG } })
    assert.equal(published.status, 200)
    assert.equal(publishCalls, 1)
  }, siteConfigService)
})

test('removed Admin provider, model, credit, and server task routes return 404', async () => {
  await withServer(createUnavailableAdminService(), async (port) => {
    for (const path of [
      '/admin/v1/providers',
      '/admin/v1/providers/provider-id',
      '/admin/v1/models',
      '/admin/v1/models/model-id',
      '/admin/v1/tasks',
      '/admin/v1/tasks/task-id',
    ]) {
      const result = await request(port, { path, origin: config.allowedOrigins[0] })
      assert.equal(result.status, 404, path)
      assert.equal((result.body.error as { code: string }).code, 'RESOURCE_NOT_FOUND', path)
    }

    const token = await csrf(port)
    const creditAdjustment = await request(port, {
      path: '/admin/v1/workspaces/workspace-id/credits/adjust',
      method: 'POST',
      origin: config.allowedOrigins[0],
      cookie: token.cookie,
      csrf: token.token,
      body: { amount: 1 },
    })
    assert.equal(creditAdjustment.status, 404)
    assert.equal((creditAdjustment.body.error as { code: string }).code, 'RESOURCE_NOT_FOUND')
  })
})
