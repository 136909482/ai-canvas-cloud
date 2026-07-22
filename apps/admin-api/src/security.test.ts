import assert from 'node:assert/strict'
import type http from 'node:http'
import test from 'node:test'
import { createCsrfToken, handleAdminSecurityBoundary, verifyCsrf } from './security.ts'

function responseDouble() {
  const headers = new Map<string, string | string[]>()
  return {
    statusCode: 200,
    ended: false,
    body: '',
    headers,
    setHeader(name: string, value: string | string[]) { headers.set(name.toLowerCase(), value) },
    end(body = '') { this.ended = true; this.body = body },
  }
}

function requestDouble(overrides: Partial<http.IncomingMessage> = {}) {
  return {
    method: 'POST',
    headers: {},
    ...overrides,
  } as http.IncomingMessage
}

const config = {
  env: 'production',
  allowedOrigins: ['https://admin.example.com'],
  betterAuthSecret: 'admin-secret-that-is-long-enough-for-tests',
}

test('Admin security boundary rejects cross Origin and forged CSRF writes', () => {
  const crossOrigin = responseDouble()
  assert.equal(handleAdminSecurityBoundary(requestDouble({ headers: { origin: 'https://evil.example' } }), crossOrigin as unknown as http.ServerResponse, config, 'request-1'), true)
  assert.equal(crossOrigin.statusCode, 403)

  const forged = responseDouble()
  assert.equal(handleAdminSecurityBoundary(requestDouble({ headers: {
    origin: 'https://admin.example.com',
    cookie: 'ai_canvas_admin.csrf=forged',
    'x-csrf-token': 'forged',
  } }), forged as unknown as http.ServerResponse, config, 'request-2'), true)
  assert.equal(forged.statusCode, 403)
})

test('Admin security boundary accepts only a signed, unexpired double-submit token', () => {
  const now = Date.now()
  const token = createCsrfToken(config.betterAuthSecret, now)
  const request = requestDouble({ headers: {
    origin: 'https://admin.example.com',
    cookie: `ai_canvas_admin.csrf=${token}`,
    'x-csrf-token': token,
    'sec-fetch-site': 'same-site',
  } })
  assert.equal(verifyCsrf(request, config.betterAuthSecret, now), true)
  assert.equal(handleAdminSecurityBoundary(request, responseDouble() as unknown as http.ServerResponse, config, 'request-3'), false)
  assert.equal(verifyCsrf(request, config.betterAuthSecret, now + 2 * 60 * 60 * 1000 + 1_000), false)
})

test('Admin security boundary allows DELETE during an allowed Origin preflight', () => {
  const response = responseDouble()
  const request = requestDouble({
    method: 'OPTIONS',
    headers: {
      origin: 'https://admin.example.com',
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'x-csrf-token',
    },
  })

  assert.equal(handleAdminSecurityBoundary(request, response as unknown as http.ServerResponse, config, 'request-4'), true)
  assert.equal(response.statusCode, 204)
  assert.equal(response.ended, true)
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, POST, DELETE, OPTIONS')
})
