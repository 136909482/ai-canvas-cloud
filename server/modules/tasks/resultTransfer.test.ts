import assert from 'node:assert/strict'
import test from 'node:test'
import { createMetricsRegistry } from '@ai-canvas-cloud/shared'
import {
  TaskResultTransferError,
  transferProviderTaskResult,
} from '../../dist/modules/tasks/resultTransfer.js'

const TASK_ID = '11111111-1111-4111-8111-111111111111'

test('provider task result transfer validates and stores a deterministic private result', async () => {
  const writes: Array<{ objectKey: string; mimeType: string; body: Uint8Array }> = []
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const input = {
    providerId: 'openai' as const,
    resultUrl: 'https://api.openai.com/results/image.png',
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: '22222222-2222-4222-8222-222222222222',
    taskId: TASK_ID,
    resultIndex: 0,
    objectStorage: {
      async putObject(value: { objectKey: string; mimeType: string; body: Uint8Array }) {
        writes.push(value)
      },
    },
    fetch: async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
  }
  const first = await transferProviderTaskResult(input)
  const second = await transferProviderTaskResult(input)

  assert.equal(writes.length, 2)
  assert.equal(first.assetId, second.assetId)
  assert.equal(first.objectKey, second.objectKey)
  assert.match(first.objectKey, /generated\/task-results\//)
  assert.equal(first.mimeType, 'image/png')
  assert.equal(first.byteSize, png.byteLength)
})

test('provider task result transfer rejects unapproved URLs before any request', async () => {
  await assert.rejects(
    () => transferProviderTaskResult({
      providerId: 'openai',
      resultUrl: 'https://api.openai.com.evil.example/result.png',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: '22222222-2222-4222-8222-222222222222',
      taskId: TASK_ID,
      resultIndex: 0,
      objectStorage: { async putObject() {} },
    }),
    (error: unknown) => error instanceof TaskResultTransferError && error.code === 'RESULT_URL_REJECTED',
  )
})

test('provider task result transfer exposes Provider rate limiting as a stable retry signal', async () => {
  await assert.rejects(
    () => transferProviderTaskResult({
      providerId: 'openai',
      resultUrl: 'https://api.openai.com/results/image.png',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: '22222222-2222-4222-8222-222222222222',
      taskId: TASK_ID,
      resultIndex: 0,
      objectStorage: { async putObject() {} },
      fetch: async () => new Response(null, { status: 429 }),
    }),
    (error: unknown) => error instanceof TaskResultTransferError && error.code === 'RESULT_RATE_LIMITED',
  )
})

test('provider result transfer counts sanitized failure categories', async () => {
  const metrics = createMetricsRegistry()
  await assert.rejects(
    () => transferProviderTaskResult({
      providerId: 'openai',
      resultUrl: 'https://evil.example/result.png',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: '22222222-2222-4222-8222-222222222222',
      taskId: TASK_ID,
      resultIndex: 0,
      objectStorage: { async putObject() {} },
      metrics,
    }),
    /RESULT_URL_REJECTED/,
  )
  const failure = metrics.snapshot().counters.find((item) => item.name === 'ai_canvas_task_result_transfer_failures_total')
  assert.equal(failure?.labels.code, 'RESULT_URL_REJECTED')
})
