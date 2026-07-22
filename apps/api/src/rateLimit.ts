import { createHash } from 'node:crypto'
import { Redis } from 'ioredis'

export type RateLimitBucket =
  | 'auth_attempt'
  | 'password_email'
  | 'asset_prepare'
  | 'migration_prepare'
  | 'read'
  | 'write'

interface RateLimitPolicy {
  windowSeconds: number
  maxRequests: number
  failureMode: 'open' | 'closed'
}

export interface RateLimitDecision {
  allowed: boolean
  available: boolean
  retryAfterSeconds: number
  bucket: RateLimitBucket
}

export interface RateLimiter {
  consume(bucket: RateLimitBucket, scopes: string[]): Promise<RateLimitDecision>
  ping(): Promise<void>
  close(): Promise<void>
}

export interface RedisRateLimitClient {
  status: string
  connect(): Promise<unknown>
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>
  ping(): Promise<unknown>
  disconnect(): void
}

export const RATE_LIMIT_POLICIES: Record<RateLimitBucket, RateLimitPolicy> = {
  auth_attempt: { windowSeconds: 60, maxRequests: 10, failureMode: 'closed' },
  password_email: { windowSeconds: 300, maxRequests: 5, failureMode: 'closed' },
  asset_prepare: { windowSeconds: 60, maxRequests: 30, failureMode: 'closed' },
  migration_prepare: { windowSeconds: 300, maxRequests: 10, failureMode: 'closed' },
  read: { windowSeconds: 60, maxRequests: 240, failureMode: 'open' },
  write: { windowSeconds: 60, maxRequests: 120, failureMode: 'closed' },
}

const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if current > tonumber(ARGV[2]) then
  return {0, ttl}
end
return {1, ttl}
`

function hashScope(scope: string) {
  return createHash('sha256').update(scope).digest('hex')
}

function normalizeRetryAfter(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.ceil(parsed), 86_400) : fallback
}

export function createRedisRateLimiter(redisUrl: string, environment: string): RateLimiter {
  let lastError: Error | null = null
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 100, 1_000),
  })
  client.on('error', (error) => {
    lastError = error
  })

  return createRateLimiterWithRedisClient(client, environment, () => lastError)
}

export function createRateLimiterWithRedisClient(
  client: RedisRateLimitClient,
  environment: string,
  getLastError?: () => Error | null,
): RateLimiter {
  let initialConnectPromise: Promise<void> | undefined

  async function ensureConnected() {
    if (client.status === 'wait') {
      initialConnectPromise ??= Promise.resolve(client.connect())
        .then(() => undefined)
        .finally(() => {
          initialConnectPromise = undefined
        })
    }
    if (initialConnectPromise) {
      await initialConnectPromise
    }
    if (client.status !== 'ready') {
      throw new Error('Redis is not ready')
    }
  }

  return {
    async consume(bucket, scopes) {
      const policy = RATE_LIMIT_POLICIES[bucket]
      const keys = [...new Set(scopes.filter((scope) => scope.trim()).map((scope) =>
        `ai-canvas:${environment}:ratelimit:${bucket}:${hashScope(scope)}`))]
      if (keys.length === 0) {
        return { allowed: true, available: true, retryAfterSeconds: 0, bucket }
      }

      try {
        await ensureConnected()
        for (const key of keys) {
          const result = await client.eval(
            WINDOW_SCRIPT,
            1,
            key,
            String(policy.windowSeconds),
            String(policy.maxRequests),
          ) as [number, number]
          const allowed = Number(result[0]) === 1
          const retryAfterSeconds = normalizeRetryAfter(result[1], policy.windowSeconds)
          if (!allowed) {
            return { allowed: false, available: true, retryAfterSeconds, bucket }
          }
        }
        return { allowed: true, available: true, retryAfterSeconds: 0, bucket }
      } catch {
        return {
          allowed: policy.failureMode === 'open',
          available: false,
          retryAfterSeconds: policy.failureMode === 'closed' ? 1 : 0,
          bucket,
        }
      }
    },
    async ping() {
      try {
        await ensureConnected()
        await client.ping()
      } catch (error) {
        throw getLastError?.() ?? error
      }
    },
    async close() {
      if (client.status !== 'end') {
        client.disconnect()
      }
    },
  }
}

export function createMemoryRateLimiter(now = () => Date.now()): RateLimiter {
  const entries = new Map<string, { count: number; expiresAt: number }>()

  return {
    async consume(bucket, scopes) {
      const policy = RATE_LIMIT_POLICIES[bucket]
      const timestamp = now()
      let retryAfterSeconds = 0
      for (const scope of [...new Set(scopes.filter((value) => value.trim()))]) {
        const key = `${bucket}:${scope}`
        const current = entries.get(key)
        if (!current || current.expiresAt <= timestamp) {
          entries.set(key, { count: 1, expiresAt: timestamp + policy.windowSeconds * 1000 })
          continue
        }
        current.count += 1
        if (current.count > policy.maxRequests) {
          retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((current.expiresAt - timestamp) / 1000))
        }
      }
      return {
        allowed: retryAfterSeconds === 0,
        available: true,
        retryAfterSeconds,
        bucket,
      }
    },
    async ping() {},
    async close() {},
  }
}
