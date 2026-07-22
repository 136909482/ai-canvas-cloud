import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { CreateSiteAssetRequest, PublishSiteConfigRequest } from '@ai-canvas-cloud/contracts'
import { hasDuplicateJsonObjectKeys, type Logger, type MeasuredDependencyStatus } from '@ai-canvas-cloud/shared'
import {
  AdminAccessError,
  createUnavailableAdminSiteConfigService,
  type AdminRequestContext,
  type AdminService,
  type AdminSiteConfigService,
} from '@ai-canvas-cloud/server/modules/admin'
import type { AdminApiConfig } from './config.js'
import { clearCsrfCookie, createCsrfCookie, createCsrfToken, getAdminClientIp, handleAdminSecurityBoundary } from './security.js'

interface AdminServerOptions {
  config: AdminApiConfig
  adminService: AdminService
  siteConfigService?: AdminSiteConfigService
  logger: Logger
  readinessChecks?: {
    postgres?: () => Promise<MeasuredDependencyStatus>
    objectStorage?: () => Promise<MeasuredDependencyStatus>
  }
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown, requestId: string) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-request-id', requestId)
  response.end(JSON.stringify(payload))
}

function appendCookies(response: http.ServerResponse, cookies: string[]) {
  if (cookies.length > 0) response.setHeader('set-cookie', cookies)
}

async function readJson(request: http.IncomingMessage, maxBytes = 16 * 1024) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new AdminAccessError(413, 'VALIDATION_FAILED', 'Request body is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text || hasDuplicateJsonObjectKeys(text)) throw new AdminAccessError(400, 'VALIDATION_FAILED', 'JSON body is invalid')
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new AdminAccessError(400, 'VALIDATION_FAILED', 'JSON body is invalid')
  }
}

function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (typeof value !== 'string') throw new AdminAccessError(400, 'VALIDATION_FAILED', `${key} is required`)
  return value
}

function optionalStringField(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new AdminAccessError(400, 'VALIDATION_FAILED', `${key} must be a string`)
  return value
}

function booleanField(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (typeof value !== 'boolean') throw new AdminAccessError(400, 'VALIDATION_FAILED', `${key} must be a boolean`)
  return value
}

function requestContext(request: http.IncomingMessage, config: AdminApiConfig, requestId: string): AdminRequestContext {
  return {
    requestId,
    cookieHeader: request.headers.cookie,
    ipAddress: getAdminClientIp(request, config.trustProxy),
    userAgent: request.headers['user-agent'],
  }
}

function sendError(response: http.ServerResponse, error: unknown, requestId: string) {
  const mapped = error instanceof AdminAccessError
    ? error
    : new AdminAccessError(500, 'SERVICE_UNAVAILABLE', 'Administrator request failed')
  sendJson(response, mapped.statusCode, {
    error: { code: mapped.code, message: mapped.message, retryable: mapped.statusCode >= 500, requestId },
  }, requestId)
}

export function createAdminApiServer({
  config,
  adminService,
  siteConfigService = createUnavailableAdminSiteConfigService(),
  logger,
  readinessChecks,
}: AdminServerOptions) {
  return http.createServer(async (request, response) => {
    const requestId = randomUUID()
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    logger.info('request.received', { requestId, method: request.method, pathGroup: url.pathname.replace(/[0-9a-f-]{36}/gi, ':id') })
    if (handleAdminSecurityBoundary(request, response, config, requestId)) return
    try {
      if (url.pathname === '/health/live' && request.method === 'GET') {
        sendJson(response, 200, { status: 'ok', service: 'admin-api', requestId, checkedAt: new Date().toISOString() }, requestId)
        return
      }
      if (url.pathname === '/health/ready' && request.method === 'GET') {
        try {
          if (!readinessChecks?.postgres || !readinessChecks.objectStorage) throw new Error()
          const [postgres, objectStorage] = await Promise.all([readinessChecks.postgres(), readinessChecks.objectStorage()])
          const ok = postgres.ok && objectStorage.ok
          sendJson(response, ok ? 200 : 503, {
            status: ok ? 'ok' : 'degraded',
            service: 'admin-api',
            requestId,
            dependencies: { postgres, objectStorage },
            checkedAt: new Date().toISOString(),
          }, requestId)
        } catch {
          sendJson(response, 503, { status: 'degraded', service: 'admin-api', requestId, dependencies: { postgres: { ok: false, latencyMs: 0, error: 'unknown' }, objectStorage: { ok: false, latencyMs: 0, error: 'unknown' } }, checkedAt: new Date().toISOString() }, requestId)
        }
        return
      }
      if (url.pathname === '/admin/v1/auth/csrf' && request.method === 'GET') {
        const token = createCsrfToken(config.betterAuthSecret)
        appendCookies(response, [createCsrfCookie(token, config)])
        sendJson(response, 200, { token }, requestId)
        return
      }
      const context = requestContext(request, config, requestId)
      if (url.pathname === '/admin/v1/auth/captcha' && request.method === 'GET') {
        sendJson(response, 200, await adminService.createLoginCaptcha(), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/login' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.login({
          username: stringField(body, 'username'),
          password: stringField(body, 'password'),
          captchaChallengeId: optionalStringField(body, 'captchaChallengeId'),
          captchaCode: optionalStringField(body, 'captchaCode'),
        }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/session' && request.method === 'GET') {
        sendJson(response, 200, await adminService.getSession(context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/username' && request.method === 'POST') {
        const body = await readJson(request)
        sendJson(response, 200, await adminService.updateUsername({ username: stringField(body, 'username') }, context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/password' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.changePassword({
          currentPassword: stringField(body, 'currentPassword'),
          newPassword: stringField(body, 'newPassword'),
        }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/login-security' && request.method === 'GET') {
        sendJson(response, 200, await adminService.getLoginSecuritySettings(context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/login-security' && request.method === 'POST') {
        const body = await readJson(request)
        sendJson(response, 200, await adminService.updateLoginSecuritySettings({
          captchaEnabled: booleanField(body, 'captchaEnabled'),
        }, context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/logout' && request.method === 'POST') {
        const result = await adminService.logout(context)
        appendCookies(response, [...result.setCookieHeaders, clearCsrfCookie(config)])
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/audit-events' && request.method === 'GET') {
        const limitValue = url.searchParams.get('limit')
        const resultValue = url.searchParams.get('result')
        const result = resultValue === 'success' || resultValue === 'failure' ? resultValue : undefined
        sendJson(response, 200, await adminService.listAuditEvents({
          cursor: url.searchParams.get('cursor') ?? undefined,
          action: url.searchParams.get('action') ?? undefined,
          result,
          limit: limitValue === null ? undefined : Number(limitValue),
        }, context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/site-config' && request.method === 'GET') {
        sendJson(response, 200, await siteConfigService.getCurrent(context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/site-config' && request.method === 'POST') {
        const body = await readJson(request, 32 * 1024)
        sendJson(response, 200, await siteConfigService.publish(body as unknown as PublishSiteConfigRequest, context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/site-assets' && request.method === 'GET') {
        sendJson(response, 200, await siteConfigService.listAssets(context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/site-assets' && request.method === 'POST') {
        const body = await readJson(request)
        sendJson(response, 201, await siteConfigService.createAsset(body as unknown as CreateSiteAssetRequest, context), requestId)
        return
      }
      const siteAssetCompletion = /^\/admin\/v1\/site-assets\/([0-9a-f-]{36})\/complete$/i.exec(url.pathname)
      if (siteAssetCompletion && request.method === 'POST') {
        sendJson(response, 200, await siteConfigService.completeAsset(siteAssetCompletion[1]!, context), requestId)
        return
      }
      sendJson(response, 404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'Route not found', retryable: false, requestId } }, requestId)
    } catch (error) {
      logger.warn('request.rejected', { requestId, error: error instanceof AdminAccessError ? error.code : 'SERVICE_UNAVAILABLE' })
      sendError(response, error, requestId)
    }
  })
}

export async function closeAdminApiServer(server: http.Server, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out closing Admin API server')), timeoutMs)
    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
}
