import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMemoryRateLimiter,
  createRateLimiterWithRedisClient,
  RATE_LIMIT_POLICIES,
  type RedisRateLimitClient,
} from './rateLimit.ts'

test('memory rate limiter enforces a window and recovers after expiry', async () => {
  let now = 1_000
  const limiter = createMemoryRateLimiter(() => now)

  for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.auth_attempt.maxRequests; attempt += 1) {
    assert.equal((await limiter.consume('auth_attempt', ['ip:198.51.100.10'])).allowed, true)
  }
  const blocked = await limiter.consume('auth_attempt', ['ip:198.51.100.10'])
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.available, true)
  assert(blocked.retryAfterSeconds > 0)

  now += RATE_LIMIT_POLICIES.auth_attempt.windowSeconds * 1_000
  assert.equal((await limiter.consume('auth_attempt', ['ip:198.51.100.10'])).allowed, true)
})

test('session limits follow one account across IP changes', async () => {
  const limiter = createMemoryRateLimiter()
  for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.task_create.maxRequests; attempt += 1) {
    assert.equal((await limiter.consume('task_create', [
      'session:session-a',
      `ip:198.51.100.${attempt + 1}`,
    ])).allowed, true)
  }
  assert.equal((await limiter.consume('task_create', [
    'session:session-a',
    'ip:203.0.113.1',
  ])).allowed, false)
})

test('network limits cover multiple accounts sharing one IP', async () => {
  const limiter = createMemoryRateLimiter()
  for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.task_create.maxRequests; attempt += 1) {
    assert.equal((await limiter.consume('task_create', [
      `session:session-${attempt}`,
      'ip:198.51.100.20',
    ])).allowed, true)
  }
  assert.equal((await limiter.consume('task_create', [
    'session:another-account',
    'ip:198.51.100.20',
  ])).allowed, false)
})

test('Redis outages fail closed for high-risk writes and recover without restarting the API', async () => {
  let count = 0
  const client: RedisRateLimitClient = {
    status: 'reconnecting',
    async connect() { this.status = 'ready' },
    async eval() { count += 1; return [1, 60] },
    async ping() { return 'PONG' },
    disconnect() { this.status = 'end' },
  }
  const limiter = createRateLimiterWithRedisClient(client, 'staging-test')

  const closed = await limiter.consume('task_create', ['session:trusted-session'])
  assert.equal(closed.allowed, false)
  assert.equal(closed.available, false)

  const open = await limiter.consume('read', ['session:trusted-session'])
  assert.equal(open.allowed, true)
  assert.equal(open.available, false)

  client.status = 'ready'
  const recovered = await limiter.consume('task_create', ['session:trusted-session'])
  assert.equal(recovered.allowed, true)
  assert.equal(recovered.available, true)
  assert.equal(count, 1)
})

test('Redis readiness preserves the latest low-level connection failure for stable classification', async () => {
  const connectionError = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
  const client: RedisRateLimitClient = {
    status: 'ready',
    async connect() {},
    async eval() { return [1, 60] },
    async ping() { throw new Error('Connection is closed') },
    disconnect() {},
  }
  const limiter = createRateLimiterWithRedisClient(client, 'development', () => connectionError)

  await assert.rejects(limiter.ping(), (error: Error & { code?: string }) => error.code === 'ECONNREFUSED')
})
