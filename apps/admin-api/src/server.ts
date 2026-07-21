import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { hasDuplicateJsonObjectKeys, type Logger, type MeasuredDependencyStatus } from '@ai-canvas-cloud/shared'
import { AdminAccessError, type AdminRequestContext, type AdminService } from '@ai-canvas-cloud/server/modules/admin'
import type { AdminApiConfig } from './config.js'
import { clearCsrfCookie, createCsrfCookie, createCsrfToken, getAdminClientIp, handleAdminSecurityBoundary } from './security.js'

interface AdminServerOptions {
  config: AdminApiConfig
  adminService: AdminService
  logger: Logger
  readinessCheck?: () => Promise<MeasuredDependencyStatus>
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

export function createAdminApiServer({ config, adminService, logger, readinessCheck }: AdminServerOptions) {
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
          if (!readinessCheck) throw new Error()
          const postgres = await readinessCheck()
          sendJson(response, postgres.ok ? 200 : 503, {
            status: postgres.ok ? 'ok' : 'degraded',
            service: 'admin-api',
            requestId,
            dependencies: { postgres },
            checkedAt: new Date().toISOString(),
          }, requestId)
        } catch {
          sendJson(response, 503, { status: 'degraded', service: 'admin-api', requestId, dependencies: { postgres: { ok: false, latencyMs: 0, error: 'unknown' } }, checkedAt: new Date().toISOString() }, requestId)
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
      if (url.pathname === '/admin/v1/auth/login' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.login({ email: stringField(body, 'email'), password: stringField(body, 'password') }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/session' && request.method === 'GET') {
        sendJson(response, 200, await adminService.getSession(context), requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/mfa/setup' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.setupTotp({ password: stringField(body, 'password') }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/mfa/verify-totp' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.verifyTotp({ code: stringField(body, 'code') }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/mfa/verify-recovery' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.verifyRecoveryCode({ code: stringField(body, 'code') }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
        return
      }
      if (url.pathname === '/admin/v1/auth/mfa/recovery-codes' && request.method === 'POST') {
        const body = await readJson(request)
        const result = await adminService.regenerateRecoveryCodes({ password: stringField(body, 'password') }, context)
        appendCookies(response, result.setCookieHeaders)
        sendJson(response, 200, result.response, requestId)
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
