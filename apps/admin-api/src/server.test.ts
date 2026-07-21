import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { AdminAccessError, createUnavailableAdminService, type AdminService } from '@ai-canvas-cloud/server/modules/admin'
import { createAdminApiServer } from './server.ts'

const config = {
  env: 'development', host: '127.0.0.1', port: 8788, logLevel: 'error' as const,
  shutdownTimeoutMs: 1_000, trustProxy: false,
  databaseUrl: 'postgres://admin_role@localhost/cloud',
  betterAuthUrl: 'http://127.0.0.1:8788',
  betterAuthSecret: 'admin-secret-that-is-long-enough-for-tests',
  webPublicUrl: 'http://localhost:5174',
  allowedOrigins: ['http://localhost:5174'],
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

async function withServer(service: AdminService, operation: (port: number) => Promise<void>) {
  const server = createAdminApiServer({ config, adminService: service, logger })
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
  const service = { ...createUnavailableAdminService(), async login() { loginCalls += 1; return { response: { state: 'mfa_required' as const }, setCookieHeaders: [] } } }
  await withServer(service, async (port) => {
    const rejected = await request(port, { path: '/admin/v1/auth/login', method: 'POST', origin: config.allowedOrigins[0], body: { email: 'admin@example.com', password: 'password-long-enough' } })
    assert.equal(rejected.status, 403)
    assert.equal(loginCalls, 0)
    const token = await csrf(port)
    const accepted = await request(port, { path: '/admin/v1/auth/login', method: 'POST', origin: config.allowedOrigins[0], cookie: token.cookie, csrf: token.token, body: { email: 'admin@example.com', password: 'password-long-enough' } })
    assert.equal(accepted.status, 200)
    assert.equal(loginCalls, 1)
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
