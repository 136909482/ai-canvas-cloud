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
  PROVIDER_CREDENTIAL_KEYS: `1:${Buffer.alloc(32, 1).toString('base64')}`,
  PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION: '1',
}

test('Worker config validates dependencies and shutdown timeout', () => {
  const config = loadWorkerConfig({
    ...baseEnv,
    WORKER_SHUTDOWN_TIMEOUT_MS: '5000',
    WORKER_INSTANCE_ID: 'worker-test',
    WORKER_TASK_QUEUE_NAME: 'test-generation',
  })

  assert.equal(config.shutdownTimeoutMs, 5000)
  assert.equal(config.redisUrl, 'redis://local')
  assert.equal(config.instanceId, 'worker-test')
  assert.equal(config.taskQueueName, 'test-generation')
  assert.equal(config.outboxBatchSize, 25)
  assert.equal(config.providerCredentialActiveKeyVersion, 1)
})

test('Worker config rejects invalid timeout', () => {
  assert.throws(() => loadWorkerConfig({ ...baseEnv, WORKER_SHUTDOWN_TIMEOUT_MS: '0' }), /WORKER_SHUTDOWN_TIMEOUT_MS/)
})

test('Worker config rejects an outbox retry base above the maximum', () => {
  assert.throws(
    () => loadWorkerConfig({
      ...baseEnv,
      WORKER_OUTBOX_RETRY_BASE_MS: '2000',
      WORKER_OUTBOX_RETRY_MAX_MS: '1000',
    }),
    /WORKER_OUTBOX_RETRY_BASE_MS/,
  )
})

test('Worker config keeps lease heartbeats below TTL and retry bounds ordered', () => {
  assert.throws(
    () => loadWorkerConfig({
      ...baseEnv,
      WORKER_TASK_LEASE_TTL_MS: '1000',
      WORKER_TASK_LEASE_HEARTBEAT_MS: '1000',
    }),
    /WORKER_TASK_LEASE_HEARTBEAT_MS/,
  )
  assert.throws(
    () => loadWorkerConfig({
      ...baseEnv,
      WORKER_TASK_RETRY_BASE_MS: '2000',
      WORKER_TASK_RETRY_MAX_MS: '1000',
    }),
    /WORKER_TASK_RETRY_BASE_MS/,
  )
})
