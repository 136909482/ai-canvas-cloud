import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRedisConnectionOptions } from './taskQueue.ts'

test('Redis connection parser supports credentials, database, and TLS', () => {
  assert.deepEqual(parseRedisConnectionOptions('redis://user:p%40ss@redis.example:6380/4'), {
    host: 'redis.example',
    port: 6380,
    db: 4,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    username: 'user',
    password: 'p@ss',
  })
  assert.deepEqual(parseRedisConnectionOptions('rediss://redis.example'), {
    host: 'redis.example',
    port: 6379,
    db: 0,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    tls: {},
  })
})

test('Redis connection parser rejects unsupported protocols and databases', () => {
  assert.throws(() => parseRedisConnectionOptions('https://redis.example'), /redis:\/\//)
  assert.throws(() => parseRedisConnectionOptions('redis://redis.example/not-a-number'), /database/)
})
