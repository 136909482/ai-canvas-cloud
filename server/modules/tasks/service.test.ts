import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import {
  GENERATION_TASK_PARAMETERS_MAX_BYTES,
  validateCreateGenerationTaskRequest,
} from '../../dist/modules/tasks/service.js'

const validRequest = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sourceNodeId: 'source-node',
  kind: 'image' as const,
  providerId: 'openai',
  model: 'gpt-image-2',
  parameters: { prompt: 'draw a cloud', count: 1 },
  idempotencyKey: 'task-create-1',
}

test('generation task request validation normalizes UUIDs and defaults workspace billing', () => {
  const request = validateCreateGenerationTaskRequest({
    ...validRequest,
    projectId: validRequest.projectId.toUpperCase(),
  })
  assert.equal(request.projectId, validRequest.projectId)
  assert.equal(request.previewNodeId, null)
  assert.equal(request.billingMode, 'workspace_key')
  assert.deepEqual(request.parameters, validRequest.parameters)
})

test('generation task request rejects credentials, target URLs, invalid JSON, and oversized input', () => {
  for (const parameters of [
    { apiKey: 'secret' },
    { nested: { Authorization: 'Bearer secret' } },
    { endpoint: 'https://example.com' },
    { target_url: 'http://127.0.0.1' },
  ]) {
    assert.throws(
      () => validateCreateGenerationTaskRequest({ ...validRequest, parameters }),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )
  }
  assert.throws(
    () => validateCreateGenerationTaskRequest({ ...validRequest, parameters: { value: Number.NaN } }),
    /non-finite/,
  )
  assert.throws(
    () => validateCreateGenerationTaskRequest({
      ...validRequest,
      parameters: { prompt: 'x'.repeat(GENERATION_TASK_PARAMETERS_MAX_BYTES) },
    }),
    /at most/,
  )
})

test('generation task request enforces supported task and billing modes', () => {
  assert.throws(
    () => validateCreateGenerationTaskRequest({ ...validRequest, kind: 'audio' as 'image' }),
    /kind must be image or video/,
  )
  assert.throws(
    () => validateCreateGenerationTaskRequest({ ...validRequest, billingMode: 'platform' }),
    /Only workspace_key billing/,
  )
})
