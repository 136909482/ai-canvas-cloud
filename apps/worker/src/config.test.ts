import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkerConfig } from './config.ts'

const baseEnv = {
  DATABASE_URL: 'postgres://local',
  REDIS_URL: 'redis://local',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
}

test('Worker config validates dependencies and shutdown timeout', () => {
  const config = loadWorkerConfig({ ...baseEnv, WORKER_SHUTDOWN_TIMEOUT_MS: '5000' })

  assert.equal(config.shutdownTimeoutMs, 5000)
  assert.equal(config.redisUrl, 'redis://local')
})

test('Worker config rejects invalid timeout', () => {
  assert.throws(() => loadWorkerConfig({ ...baseEnv, WORKER_SHUTDOWN_TIMEOUT_MS: '0' }), /WORKER_SHUTDOWN_TIMEOUT_MS/)
})
