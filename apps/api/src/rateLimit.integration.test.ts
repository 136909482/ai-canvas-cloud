import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { loadDotEnv } from '@ai-canvas-cloud/server'
import { createRedisRateLimiter, RATE_LIMIT_POLICIES } from './rateLimit.ts'

loadDotEnv()

const redisUrl = process.env.REDIS_URL

test('two API limiter instances share Redis limits and serialize concurrent bursts', {
  skip: redisUrl ? false : 'REDIS_URL is not configured',
}, async (context) => {
  const environment = `test-${randomUUID()}`
  const first = createRedisRateLimiter(redisUrl!, environment)
  const second = createRedisRateLimiter(redisUrl!, environment)

  try {
    try {
      await Promise.all([first.ping(), second.ping()])
    } catch {
      context.skip('The configured Redis server is unavailable or rejected REDIS_URL credentials')
      return
    }

    const sharedScope = `session:${randomUUID()}`
    for (let attempt = 0; attempt < RATE_LIMIT_POLICIES.auth_attempt.maxRequests; attempt += 1) {
      const limiter = attempt % 2 === 0 ? first : second
      assert.equal((await limiter.consume('auth_attempt', [sharedScope])).allowed, true)
    }
    const blocked = await second.consume('auth_attempt', [sharedScope])
    assert.equal(blocked.allowed, false)
    assert(blocked.retryAfterSeconds > 0)

    const burstScope = `session:${randomUUID()}`
    const burst = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? first : second).consume('auth_attempt', [burstScope])))
    assert.equal(burst.filter((decision) => decision.allowed).length, RATE_LIMIT_POLICIES.auth_attempt.maxRequests)
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})
