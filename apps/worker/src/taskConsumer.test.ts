import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type {
  GenerationTaskExecutionService,
  GenerationTaskLease,
} from '@ai-canvas-cloud/server'
import {
  createGenerationTaskJobProcessor,
  GenerationTaskProcessingError,
} from '../dist/taskConsumer.js'

function lease(): GenerationTaskLease {
  return {
    taskId: randomUUID(),
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    sourceNodeId: 'source',
    previewNodeId: null,
    kind: 'image',
    providerId: 'openai',
    model: 'gpt-image-2',
    billingMode: 'workspace_key',
    queueLane: 'default',
    parameters: { prompt: 'test' },
    attemptNumber: 1,
    maxAttempts: 3,
    workerId: 'worker-test',
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

function fakeService(taskLease: GenerationTaskLease) {
  const failures: Parameters<GenerationTaskExecutionService['settleFailure']>[0][] = []
  let canceled = 0
  const service = {
    async claimTask() { return taskLease },
    async renewLease() { return { renewed: true, cancelRequested: false, leaseExpiresAt: taskLease.leaseExpiresAt } },
    async updateProgress() { return { renewed: true, cancelRequested: false, leaseExpiresAt: taskLease.leaseExpiresAt } },
    async settleCanceled() { canceled += 1; return { settled: true, status: 'canceled' as const } },
    async settleFailure(input: Parameters<GenerationTaskExecutionService['settleFailure']>[0]) {
      failures.push(input)
      return { settled: true, status: input.retryable ? 'queued' as const : 'failed' as const }
    },
    async recoverExpiredLeases() { return { recovered: 0, requeued: 0, failed: 0, canceled: 0 } },
  } satisfies GenerationTaskExecutionService
  return { service, failures, get canceled() { return canceled } }
}

function job(taskId: string) {
  return {
    id: randomUUID(),
    name: 'run-generation-task',
    data: { outboxId: randomUUID(), taskId },
  }
}

test('task job processor classifies failures and protects incomplete processors', async () => {
  const taskLease = lease()
  const fake = fakeService(taskLease)
  const failing = createGenerationTaskJobProcessor({
    executionService: fake.service,
    processor: {
      async process() {
        throw new GenerationTaskProcessingError('INVALID_PROVIDER_INPUT', 'bad request', false)
      },
    },
    workerId: taskLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  await failing.process(job(taskLease.taskId))
  assert.equal(fake.failures[0]?.errorCode, 'INVALID_PROVIDER_INPUT')
  assert.equal(fake.failures[0]?.retryable, false)

  const incompleteLease = lease()
  const incompleteFake = fakeService(incompleteLease)
  const incomplete = createGenerationTaskJobProcessor({
    executionService: incompleteFake.service,
    processor: { async process() {} },
    workerId: incompleteLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  await incomplete.process(job(incompleteLease.taskId))
  assert.equal(incompleteFake.failures[0]?.errorCode, 'WORKER_PROCESSOR_INCOMPLETE')
  assert.equal(incompleteFake.failures[0]?.retryable, false)
})

test('task job processor settles cancellation reported while updating progress', async () => {
  const taskLease = lease()
  const fake = fakeService(taskLease)
  fake.service.updateProgress = async () => ({
    renewed: true,
    cancelRequested: true,
    leaseExpiresAt: taskLease.leaseExpiresAt,
  })
  const processor = createGenerationTaskJobProcessor({
    executionService: fake.service,
    processor: {
      async process(_lease, context) {
        await context.reportProgress(25)
        throw new Error(String(context.signal.reason))
      },
    },
    workerId: taskLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  await processor.process(job(taskLease.taskId))
  assert.equal(fake.canceled, 1)
  assert.equal(fake.failures.length, 0)
})

test('task job processor settles cancellation when a processor exits normally', async () => {
  const taskLease = lease()
  const fake = fakeService(taskLease)
  fake.service.renewLease = async () => ({
    renewed: true,
    cancelRequested: true,
    leaseExpiresAt: taskLease.leaseExpiresAt,
  })
  const processor = createGenerationTaskJobProcessor({
    executionService: fake.service,
    processor: { async process() {} },
    workerId: taskLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  await processor.process(job(taskLease.taskId))
  assert.equal(fake.canceled, 1)
  assert.equal(fake.failures.length, 0)
})

test('task job processor leaves settlement to lease recovery after fencing is lost', async () => {
  const taskLease = lease()
  const fake = fakeService(taskLease)
  fake.service.updateProgress = async () => ({
    renewed: false,
    cancelRequested: false,
    leaseExpiresAt: null,
  })
  const processor = createGenerationTaskJobProcessor({
    executionService: fake.service,
    processor: {
      async process(_lease, context) {
        await context.reportProgress(10)
        throw new Error('stale')
      },
    },
    workerId: taskLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  await processor.process(job(taskLease.taskId))
  assert.equal(fake.canceled, 0)
  assert.equal(fake.failures.length, 0)
})

test('task job processor requeues an active task during graceful shutdown', async () => {
  const taskLease = lease()
  const fake = fakeService(taskLease)
  const started = Promise.withResolvers<void>()
  const processor = createGenerationTaskJobProcessor({
    executionService: fake.service,
    processor: {
      async process(_lease, context) {
        started.resolve()
        await new Promise<void>((_, reject) => {
          context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    },
    workerId: taskLease.workerId,
    leaseTtlMs: 30_000,
    heartbeatMs: 10_000,
    retryDelayMs: 1_000,
  })
  const processing = processor.process(job(taskLease.taskId))
  await started.promise
  processor.abortAll()
  await processing
  assert.equal(fake.failures[0]?.errorCode, 'WORKER_SHUTDOWN')
  assert.equal(fake.failures[0]?.retryable, true)
})
