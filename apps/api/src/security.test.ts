import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { handleSecurityBoundary } from './security.ts'

function responseDouble() {
  const headers = new Map<string, string>()
  return {
    statusCode: 200,
    headers,
    ended: false,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end() { this.ended = true },
  } as unknown as http.ServerResponse & { headers: Map<string, string>; ended: boolean }
}

function request(method: string, origin?: string, headers: Record<string, string> = {}, url = '/') {
  return {
    method,
    url,
    headers: {
      ...(origin ? { origin } : {}),
      ...headers,
    },
  } as http.IncomingMessage
}

test('security boundary exposes restrictive headers and allows an explicit origin preflight', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('OPTIONS', 'https://cloud.example.com'), response, {
    env: 'staging', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-1')

  assert.equal(handled, true)
  assert.equal(response.statusCode, 204)
  assert.equal(response.ended, true)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://cloud.example.com')
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
})

test('security boundary rejects disallowed origins without echoing them', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('POST', 'https://evil.example.com'), response, {
    env: 'production', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-2')

  assert.equal(handled, true)
  assert.equal(response.statusCode, 403)
  assert.equal(response.ended, true)
  assert.equal(response.headers.get('access-control-allow-origin'), undefined)
})

test('protected cookie writes require an allowed origin', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('POST', undefined, {
    cookie: 'better-auth.session_token=opaque',
  }), response, {
    env: 'staging', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-3')

  assert.equal(handled, true)
  assert.equal(response.statusCode, 403)
  assert.equal(response.ended, true)
})

test('protected auth cookie writes require an origin even before a session exists', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('POST', undefined, {}, '/api/v1/auth/login'), response, {
    env: 'production', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-4')

  assert.equal(handled, true)
  assert.equal(response.statusCode, 403)
})

test('protected cross-site fetch metadata is rejected', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('POST', 'https://cloud.example.com', {
    'sec-fetch-site': 'cross-site',
    cookie: 'better-auth.session_token=opaque',
  }), response, {
    env: 'staging', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-5')

  assert.equal(handled, true)
  assert.equal(response.statusCode, 403)
})

test('protected same-origin cookie writes are allowed', () => {
  const response = responseDouble()
  const handled = handleSecurityBoundary(request('POST', 'https://cloud.example.com', {
    'sec-fetch-site': 'same-origin',
    cookie: 'better-auth.session_token=opaque',
  }), response, {
    env: 'staging', webAllowedOrigins: ['https://cloud.example.com'],
  }, 'request-6')

  assert.equal(handled, false)
})
