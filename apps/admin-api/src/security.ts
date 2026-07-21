import { createHmac, randomBytes } from 'node:crypto'
import type http from 'node:http'
import { safeTokenEqual } from '@ai-canvas-cloud/server/modules/admin'
import type { AdminApiConfig } from './config.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_COOKIE = 'ai_canvas_admin.csrf'
const CSRF_MAX_AGE_SECONDS = 2 * 60 * 60
const ALLOWED_METHODS = 'GET, HEAD, POST, OPTIONS'
const ALLOWED_HEADERS = 'content-type, x-csrf-token, x-request-id'

function cookieAttributes(config: Pick<AdminApiConfig, 'env'>) {
  const secure = config.env === 'production' || config.env === 'staging'
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${CSRF_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseCookies(header: string | undefined) {
  const output = new Map<string, string>()
  for (const item of (header ?? '').split(';')) {
    const index = item.indexOf('=')
    if (index > 0) output.set(item.slice(0, index).trim(), item.slice(index + 1).trim())
  }
  return output
}

export function createCsrfToken(secret: string, now = Date.now()) {
  const payload = `${Math.floor(now / 1000)}.${randomBytes(24).toString('base64url')}`
  return `${payload}.${signature(payload, secret)}`
}

export function createCsrfCookie(token: string, config: Pick<AdminApiConfig, 'env'>) {
  return `${CSRF_COOKIE}=${token}; ${cookieAttributes(config)}`
}

export function clearCsrfCookie(config: Pick<AdminApiConfig, 'env'>) {
  const secure = config.env === 'production' || config.env === 'staging'
  return `${CSRF_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}

export function verifyCsrf(request: http.IncomingMessage, secret: string, now = Date.now()) {
  const cookieToken = parseCookies(request.headers.cookie).get(CSRF_COOKIE)
  const headerToken = request.headers['x-csrf-token']
  if (!cookieToken || typeof headerToken !== 'string' || !safeTokenEqual(cookieToken, headerToken)) return false
  const parts = cookieToken.split('.')
  if (parts.length !== 3) return false
  const [timestamp, nonce, suppliedSignature] = parts
  if (!timestamp || !nonce || !suppliedSignature || !/^\d+$/.test(timestamp) || !/^[a-zA-Z0-9_-]{32}$/.test(nonce)) return false
  const issuedAt = Number(timestamp)
  const current = Math.floor(now / 1000)
  if (!Number.isSafeInteger(issuedAt) || issuedAt > current + 30 || current - issuedAt > CSRF_MAX_AGE_SECONDS) return false
  return safeTokenEqual(suppliedSignature, signature(`${timestamp}.${nonce}`, secret))
}

function sendDenied(response: http.ServerResponse, requestId: string, message: string) {
  response.statusCode = 403
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('x-request-id', requestId)
  response.end(JSON.stringify({
    error: { code: 'ADMIN_ACCESS_DENIED', message, retryable: false, requestId },
  }))
}

export function applyAdminSecurityHeaders(response: http.ServerResponse, env: string) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  response.setHeader('cross-origin-opener-policy', 'same-origin')
  response.setHeader('cross-origin-resource-policy', 'same-site')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  if (env === 'production' || env === 'staging') {
    response.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
}

export function handleAdminSecurityBoundary(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: Pick<AdminApiConfig, 'env' | 'allowedOrigins' | 'betterAuthSecret'>,
  requestId: string,
) {
  applyAdminSecurityHeaders(response, config.env)
  const origin = request.headers.origin
  const allowed = typeof origin === 'string' && config.allowedOrigins.includes(origin)
  if (origin) {
    response.setHeader('vary', 'Origin')
    if (!allowed) {
      sendDenied(response, requestId, 'Origin is not allowed')
      return true
    }
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-credentials', 'true')
  }
  if (request.method === 'OPTIONS') {
    if (!origin || !allowed) {
      sendDenied(response, requestId, 'Preflight requires an allowed Origin')
      return true
    }
    response.statusCode = 204
    response.setHeader('access-control-allow-methods', ALLOWED_METHODS)
    response.setHeader('access-control-allow-headers', ALLOWED_HEADERS)
    response.setHeader('access-control-max-age', '600')
    response.end()
    return true
  }
  if (!SAFE_METHODS.has(request.method ?? 'GET')) {
    if (!origin || !allowed || request.headers['sec-fetch-site'] === 'cross-site') {
      sendDenied(response, requestId, 'Administrator writes require an allowed Origin')
      return true
    }
    if (!verifyCsrf(request, config.betterAuthSecret)) {
      sendDenied(response, requestId, 'CSRF token is invalid or expired')
      return true
    }
  }
  return false
}

export function getAdminClientIp(request: http.IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim()
  }
  return request.socket.remoteAddress
}
