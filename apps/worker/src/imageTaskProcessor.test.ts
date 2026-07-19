import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { GenerationTaskExecutionService, GenerationTaskLease } from '@ai-canvas-cloud/server'
import { ProviderGatewayError } from '@ai-canvas-cloud/server'
import { GenerationTaskProcessingError } from '../dist/taskConsumer.js'
import {
  createAliyunAsyncImageTaskProcessor,
  createAliyunAsyncVideoTaskProcessor,
  createSynchronousOpenAiImageTaskProcessor,
} from '../dist/imageTaskProcessor.js'

function lease(): GenerationTaskLease {
  return {
    taskId: randomUUID(), workspaceId: randomUUID(), projectId: randomUUID(),
    sourceNodeId: 'source', previewNodeId: 'preview', kind: 'image', providerId: 'openai',
    model: 'gpt-image-2', billingMode: 'workspace_key', queueLane: 'default',
    parameters: { prompt: 'draw a circle' }, attemptNumber: 1, maxAttempts: 3,
    workerId: 'worker-test', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

function context() {
  return { signal: new AbortController().signal, async reportProgress() {} }
}

test('synchronous OpenAI image processor fences submission, transfers bytes, and settles once', async () => {
  const taskLease = lease()
  const submitted: unknown[] = []
  const settled: unknown[] = []
  const writes: unknown[] = []
  const executionService = {
    async prepareProviderSubmission(input: unknown) { submitted.push(input); return { action: 'submit' as const, submissionKey: 'submission' } },
    async settleSuccess(input: unknown) { settled.push(input); return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
  } as Pick<GenerationTaskExecutionService, 'prepareProviderSubmission' | 'settleSuccess'>
  const processor = createSynchronousOpenAiImageTaskProcessor({
    executionService: executionService as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async generateImage() { return { mimeType: 'image/png' as const, imageBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), usage: { total_tokens: 42 } } },
    },
    objectStorage: { async putObject(input) { writes.push(input) } },
  })
  await processor.process(taskLease, context())

  assert.equal(submitted.length, 1)
  assert.equal(writes.length, 1)
  assert.equal(settled.length, 1)
  assert.deepEqual((settled[0] as { usage: unknown }).usage, { total_tokens: 42 })
})

test('synchronous OpenAI image processor keeps Provider timeout retryable and invalid input final', async () => {
  const taskLease = lease()
  for (const scenario of [
    { error: new ProviderGatewayError('timeout', true), code: 'PROVIDER_TIMEOUT', retryable: true },
    { error: new ProviderGatewayError('rejected', false), code: 'PROVIDER_RESPONSE_REJECTED', retryable: false },
  ]) {
    const processor = createSynchronousOpenAiImageTaskProcessor({
      executionService: { async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } } } as GenerationTaskExecutionService,
      providerCredentialService: { async getExecutionCredential() { return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
      providerAdapter: {
        supportsIdempotentSubmission() { return false },
        async generateImage() { throw scenario.error },
      },
      objectStorage: { async putObject() {} },
    })
    await assert.rejects(
      () => processor.process(taskLease, context()),
      (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === scenario.code && error.retryable === scenario.retryable,
    )
  }
})

test('result transfer failure never settles a synchronous task as succeeded', async () => {
  const taskLease = lease()
  let settled = 0
  const processor = createSynchronousOpenAiImageTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } },
      async settleSuccess() { settled += 1; return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async generateImage() {
        return {
          mimeType: 'image/png' as const,
          imageBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          usage: {},
        }
      },
    },
    objectStorage: { async putObject() { throw new Error('storage unavailable') } },
  })

  await assert.rejects(
    () => processor.process(taskLease, context()),
    (error: unknown) => error instanceof GenerationTaskProcessingError
      && error.code === 'RESULT_TRANSFER_FAILED'
      && error.retryable,
  )
  assert.equal(settled, 0)
})

test('synchronous OpenAI image processor reads the leased private source asset for image edits', async () => {
  const taskLease = lease()
  taskLease.parameters = { prompt: 'replace the sky', operationType: 'image-edit' }
  const sourceReads: unknown[] = []
  const objectReads: unknown[] = []
  const editRequests: unknown[] = []
  let generated = 0
  const processor = createSynchronousOpenAiImageTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } },
      async getSourceAsset(input: unknown) {
        sourceReads.push(input)
        return { objectKey: 'workspaces/private/source.png', mimeType: 'image/png' }
      },
      async settleSuccess() { return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async generateImage() { generated += 1; throw new Error('text generation must not run for an edit') },
      async editImage(input) {
        editRequests.push(input)
        return { mimeType: 'image/png' as const, imageBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), usage: {} }
      },
    },
    objectStorage: {
      async getObjectBytes(input) { objectReads.push(input); return new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      async putObject() {},
    },
  })

  await processor.process(taskLease, context())

  assert.equal(sourceReads.length, 1)
  assert.deepEqual(objectReads, [{ objectKey: 'workspaces/private/source.png', maxBytes: 50 * 1024 * 1024 }])
  assert.equal(editRequests.length, 1)
  assert.equal((editRequests[0] as { mimeType: string }).mimeType, 'image/png')
  assert.equal(generated, 0)
})

test('synchronous OpenAI image processor fails image edits without a completed private source asset', async () => {
  const taskLease = lease()
  taskLease.parameters = { prompt: 'replace the sky', operationType: 'image-edit' }
  let objectReads = 0
  let providerCalls = 0
  const processor = createSynchronousOpenAiImageTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } },
      async getSourceAsset() { return null },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async generateImage() { providerCalls += 1; throw new Error('must not run') },
      async editImage() { providerCalls += 1; throw new Error('must not run') },
    },
    objectStorage: {
      async getObjectBytes() { objectReads += 1; return new Uint8Array() },
      async putObject() {},
    },
  })

  await assert.rejects(
    () => processor.process(taskLease, context()),
    (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === 'TASK_INPUT_ASSET_MISSING' && !error.retryable,
  )
  assert.equal(objectReads, 0)
  assert.equal(providerCalls, 0)
})

test('Aliyun async image processor records one remote task then polls and settles its transferred result', async () => {
  const taskLease = lease()
  taskLease.providerId = 'aliyun'
  taskLease.model = 'wanx2.1-t2i-turbo'
  const submissions: unknown[] = []
  const records: unknown[] = []
  const polls: unknown[] = []
  const settlements: unknown[] = []
  const processor = createAliyunAsyncImageTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } },
      async recordProviderSubmission(input: unknown) { records.push(input); return { recorded: true } },
      async settleSuccess(input: unknown) { settlements.push(input); return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async submitAliyunImageTask(input) { submissions.push(input); return { remoteTaskId: 'task-123' } },
      async pollAliyunImageTask(input) { polls.push(input); return { status: 'succeeded' as const, resultUrl: 'https://dashscope.aliyuncs.com/result.png' } },
    },
    objectStorage: { async putObject() {} },
    pollIntervalMs: 0,
    transferResult: async () => ({ assetId: randomUUID(), objectKey: 'generated/result.png', originalFileName: 'result.png', mimeType: 'image/png', byteSize: 8, sha256: 'a'.repeat(64) }),
  })

  await processor.process(taskLease, context())

  assert.equal(submissions.length, 1)
  assert.equal(records.length, 1)
  assert.deepEqual((records[0] as { remoteTaskId: string }).remoteTaskId, 'task-123')
  assert.equal(polls.length, 1)
  assert.equal(settlements.length, 1)
})

test('Aliyun async recovery polls a persisted remote task without resubmitting it', async () => {
  const taskLease = lease()
  taskLease.providerId = 'aliyun'
  taskLease.model = 'wanx2.1-t2i-turbo'
  let submissions = 0
  let polls = 0
  const processor = createAliyunAsyncImageTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'poll' as const, submissionKey: 'submission', remoteTaskId: 'task-123' } },
      async settleSuccess() { return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async submitAliyunImageTask() { submissions += 1; return { remoteTaskId: 'must-not-submit' } },
      async pollAliyunImageTask() { polls += 1; return { status: 'failed' as const } },
    },
    objectStorage: { async putObject() {} },
  })

  await assert.rejects(
    () => processor.process(taskLease, context()),
    (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === 'PROVIDER_TASK_FAILED' && !error.retryable,
  )
  assert.equal(submissions, 0)
  assert.equal(polls, 1)
})

test('Aliyun async video processor records then transfers a private video result', async () => {
  const taskLease = lease()
  taskLease.kind = 'video'
  taskLease.providerId = 'aliyun'
  taskLease.model = 'wan2.7-t2v'
  taskLease.parameters = { prompt: 'camera moves over a lake', resolution: '720P', ratio: '16:9', duration: 5 }
  let submissions = 0
  let polls = 0
  const settled: unknown[] = []
  const processor = createAliyunAsyncVideoTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } },
      async recordProviderSubmission() { return { recorded: true } },
      async settleSuccess(input: unknown) { settled.push(input); return { settled: true, status: 'succeeded' as const, assetIds: [], projectVersion: 1, projectSequence: 1 } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async submitAliyunVideoTask() { submissions += 1; return { remoteTaskId: 'video-123' } },
      async pollAliyunVideoTask() { polls += 1; return { status: 'succeeded' as const, resultUrl: 'https://dashscope.aliyuncs.com/result.mp4' } },
    },
    objectStorage: { async putObject() {} },
    transferResult: async () => ({ assetId: randomUUID(), objectKey: 'generated/result.mp4', originalFileName: 'result.mp4', mimeType: 'video/mp4', byteSize: 12, sha256: 'd'.repeat(64) }),
  })

  await processor.process(taskLease, context())
  assert.equal(submissions, 1)
  assert.equal(polls, 1)
  assert.equal(settled.length, 1)
})

test('Aliyun async video recovery polls instead of resubmitting and preserves terminal failure', async () => {
  const taskLease = lease()
  taskLease.kind = 'video'
  taskLease.providerId = 'aliyun'
  taskLease.model = 'wan2.7-t2v'
  taskLease.parameters = { prompt: 'camera moves over a lake', resolution: '720P', ratio: '16:9', duration: 5 }
  let submissions = 0
  const processor = createAliyunAsyncVideoTaskProcessor({
    executionService: {
      async prepareProviderSubmission() { return { action: 'poll' as const, submissionKey: 'submission', remoteTaskId: 'video-123' } },
    } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { return { providerId: 'aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async submitAliyunVideoTask() { submissions += 1; return { remoteTaskId: 'must-not-submit' } },
      async pollAliyunVideoTask() { return { status: 'failed' as const } },
    },
    objectStorage: { async putObject() {} },
  })
  await assert.rejects(
    () => processor.process(taskLease, context()),
    (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === 'PROVIDER_TASK_FAILED' && !error.retryable,
  )
  assert.equal(submissions, 0)
})

test('Aliyun async video processor exits before credential or provider access when canceled', async () => {
  const taskLease = lease()
  taskLease.kind = 'video'
  taskLease.providerId = 'aliyun'
  taskLease.model = 'wan2.7-t2v'
  taskLease.parameters = { prompt: 'camera moves over a lake', resolution: '720P', ratio: '16:9', duration: 5 }
  const controller = new AbortController()
  controller.abort('canceled')
  let credentialReads = 0
  let providerCalls = 0
  const processor = createAliyunAsyncVideoTaskProcessor({
    executionService: { async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } } } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { credentialReads += 1; return { providerId: 'aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'secret' } } },
    providerAdapter: {
      supportsIdempotentSubmission() { return false },
      async submitAliyunVideoTask() { providerCalls += 1; return { remoteTaskId: 'must-not-submit' } },
      async pollAliyunVideoTask() { providerCalls += 1; return { status: 'failed' as const } },
    },
    objectStorage: { async putObject() {} },
  })
  await assert.rejects(
    () => processor.process(taskLease, { signal: controller.signal, async reportProgress() {} }),
    (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === 'TASK_ABORTED',
  )
  assert.equal(credentialReads, 0)
  assert.equal(providerCalls, 0)
})

test('synchronous OpenAI image processor exits before Provider access when cancellation is already observed', async () => {
  const controller = new AbortController()
  controller.abort('canceled')
  let credentialReads = 0
  const processor = createSynchronousOpenAiImageTaskProcessor({
    executionService: { async prepareProviderSubmission() { return { action: 'submit' as const, submissionKey: 'submission' } } } as GenerationTaskExecutionService,
    providerCredentialService: { async getExecutionCredential() { credentialReads += 1; return { providerId: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'secret' } } },
    providerAdapter: { supportsIdempotentSubmission() { return false }, async generateImage() { throw new Error('should not run') } },
    objectStorage: { async putObject() {} },
  })
  await assert.rejects(
    () => processor.process(lease(), { signal: controller.signal, async reportProgress() {} }),
    (error: unknown) => error instanceof GenerationTaskProcessingError && error.code === 'TASK_ABORTED',
  )
  assert.equal(credentialReads, 0)
})
