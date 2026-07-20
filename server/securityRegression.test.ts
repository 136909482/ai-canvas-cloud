import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJsonStringify,
  validateMigrationArchiveEntries,
  validateMigrationPackagePath,
} from '@ai-canvas-cloud/contracts'
import {
  isAllowedProviderResultUrl,
  normalizeProviderBaseUrl,
  resolveProviderTaskEndpoint,
} from './dist/modules/providers/registry.js'
import {
  TaskResultTransferError,
  transferProviderTaskResult,
} from './dist/modules/tasks/resultTransfer.js'

test('security URL matrix rejects SSRF protocol, host, port, credential and ID bypasses', () => {
  const rejectedResults = [
    'http://api.openai.com/result.png',
    'https://user:password@api.openai.com/result.png',
    'https://api.openai.com:444/result.png',
    'https://api.openai.com.evil.invalid/result.png',
    'https://evil.invalid/api.openai.com/result.png',
    'https://127.0.0.1/result.png',
    'https://[::1]/result.png',
    'data:image/png;base64,AAAA',
    'blob:https://api.openai.com/fixture',
    'file:///etc/passwd',
    '//api.openai.com/result.png',
  ]
  for (const value of rejectedResults) {
    assert.equal(isAllowedProviderResultUrl('openai', value), false, value)
  }
  assert.equal(isAllowedProviderResultUrl('openai', 'https://api.openai.com:443/result.png'), true)

  const rejectedBaseUrls = [
    'http://api.openai.com',
    'https://api.openai.com:8443',
    'https://user@api.openai.com',
    'https://127.0.0.1',
    'https://localhost/v1',
    'https://service.local/v1',
    'data:text/plain,fixture',
  ]
  for (const value of rejectedBaseUrls) {
    assert.throws(() => normalizeProviderBaseUrl('openai', value), undefined, value)
  }
  assert.equal(normalizeProviderBaseUrl('custom', 'https://api.openai.com.evil.invalid/v1'), 'https://api.openai.com.evil.invalid/v1')

  for (const taskId of ['../secret', 'task/child', 'task%2fchild', 'task?target=evil', 'task#fragment', '任务']) {
    assert.throws(() => resolveProviderTaskEndpoint('aliyun', taskId), undefined, taskId)
  }
})

test('security archive and JSON matrix rejects traversal, encoding aliases, ZIP bombs and deep values', () => {
  for (const path of [
    '../secret.json',
    'assets/../secret.png',
    'assets/%2e%2e/secret.png',
    'assets\\secret.png',
    '/absolute/path',
    'C:/windows/path',
    'assets//duplicate.png',
    'assets/secret.png\0tail',
  ]) {
    assert.throws(() => validateMigrationPackagePath(path), undefined, path)
  }

  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'assets/a.png', kind: 'file', compressedSize: 1, uncompressedSize: 10_000 },
  ], { maxCompressionRatio: 10 }), /compression ratio/i)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'assets/A.png', kind: 'file', compressedSize: 1, uncompressedSize: 1 },
    { path: 'assets/a.png', kind: 'file', compressedSize: 1, uncompressedSize: 1 },
  ]), /duplicate path/i)

  let deep: Record<string, unknown> = { leaf: true }
  for (let index = 0; index < 70; index += 1) deep = { nested: deep }
  assert.throws(() => canonicalJsonStringify(deep), /depth limit/i)
  assert.throws(() => canonicalJsonStringify({ imageUrl: 'data:image/png;base64,AAAA' }), /persistent external/i)
  assert.throws(() => canonicalJsonStringify({ mediaUrls: ['blob:https://web.invalid/fixture'] }), /persistent external/i)
  assert.throws(() => canonicalJsonStringify({ value: '\ud800' }), /surrogate/i)
})

test('security transfer matrix rejects untrusted URLs, redirects and malicious MIME without storage writes', async () => {
  let fetchCalls = 0
  let storageWrites = 0
  const base = {
    providerId: 'openai' as const,
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    resultIndex: 0,
    objectStorage: {
      async putObject() { storageWrites += 1 },
    },
  }

  for (const resultUrl of ['http://127.0.0.1/private', 'https://api.openai.com.evil.invalid/result.png']) {
    await assert.rejects(
      () => transferProviderTaskResult({
        ...base,
        resultUrl,
        fetch: async () => { fetchCalls += 1; throw new Error('must not fetch') },
      }),
      (error: unknown) => error instanceof TaskResultTransferError && error.code === 'RESULT_URL_REJECTED',
    )
  }
  assert.equal(fetchCalls, 0)

  const maliciousBodies = [
    new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('<svg onload="alert(1)"></svg>', { headers: { 'content-type': 'image/png' } }),
    new Response('oversized', { headers: { 'content-type': 'image/png', 'content-length': '999999999' } }),
  ]
  for (const response of maliciousBodies) {
    let redirectMode: RequestRedirect | undefined
    await assert.rejects(
      () => transferProviderTaskResult({
        ...base,
        resultUrl: 'https://api.openai.com/result.png',
        maxBytes: 64,
        fetch: async (_url, init) => {
          redirectMode = init.redirect
          return response
        },
      }),
      TaskResultTransferError,
    )
    assert.equal(redirectMode, 'error')
  }
  assert.equal(storageWrites, 0)
})
