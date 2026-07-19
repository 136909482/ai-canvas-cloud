import assert from 'node:assert/strict'
import test from 'node:test'
import type { Logger } from '@ai-canvas-cloud/shared'
import { loadWorkerConfig } from './config.ts'
import { createWorkerRuntime } from './runtime.ts'

const config = loadWorkerConfig({
  DATABASE_URL: 'postgres://local',
  REDIS_URL: 'redis://local',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  PROVIDER_CREDENTIAL_KEYS: `1:${Buffer.alloc(32, 1).toString('base64')}`,
  PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION: '1',
  WORKER_OUTBOX_DISPATCH_INTERVAL_MS: '60000',
})

function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

test('Worker runtime dispatches in single flight and drains before closing resources', async () => {
  let dispatchCalls = 0
  let closeCalls = 0
  let releaseDispatch!: () => void
  const blockedDispatch = new Promise<void>((resolve) => {
    releaseDispatch = resolve
  })
  const runtime = createWorkerRuntime({
    config,
    logger: silentLogger(),
    dispatcher: {
      async dispatchOnce() {
        dispatchCalls += 1
        await blockedDispatch
        return { claimed: 1, published: 1, failed: 0 }
      },
    },
    async closeResources() {
      closeCalls += 1
    },
  })

  runtime.start()
  runtime.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dispatchCalls, 1)

  const stopping = runtime.stop('manual')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(closeCalls, 0)
  releaseDispatch()
  await stopping
  assert.equal(closeCalls, 1)
})

test('Worker runtime recovers expired leases in single flight and drains on stop', async () => {
  let recoveryCalls = 0
  let releaseRecovery!: () => void
  const blockedRecovery = new Promise<void>((resolve) => {
    releaseRecovery = resolve
  })
  const runtime = createWorkerRuntime({
    config,
    logger: silentLogger(),
    taskExecutionService: {
      async recoverExpiredLeases() {
        recoveryCalls += 1
        await blockedRecovery
        return { recovered: 1, requeued: 1, failed: 0, canceled: 0 }
      },
    },
  })

  runtime.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(recoveryCalls, 1)
  const stopping = runtime.stop('manual')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(recoveryCalls, 1)
  releaseRecovery()
  await stopping
})
