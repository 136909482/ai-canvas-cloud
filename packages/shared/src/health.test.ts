import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDependencyFailure, measureDependencyCheck } from './health.ts'

test('dependency failures map to stable redacted categories', () => {
  assert.equal(classifyDependencyFailure(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })), 'connection_refused')
  assert.equal(classifyDependencyFailure(Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' })), 'timeout')
  assert.equal(classifyDependencyFailure(Object.assign(new Error('password authentication failed'), { code: '28P01' })), 'authentication_failed')
  assert.equal(classifyDependencyFailure(Object.assign(new Error('permission denied'), { code: '42501' })), 'permission_denied')
  assert.equal(classifyDependencyFailure({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), 'permission_denied')
  assert.equal(classifyDependencyFailure({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }), 'bucket_unavailable')
  assert.equal(classifyDependencyFailure(new Error('redis://user:secret@private.example')), 'unknown')
})

test('dependency failure classification unwraps causes and aggregate errors', () => {
  assert.equal(classifyDependencyFailure(new Error('outer', {
    cause: Object.assign(new Error('inner'), { code: 'ECONNREFUSED' }),
  })), 'connection_refused')
  assert.equal(classifyDependencyFailure(new AggregateError([
    Object.assign(new Error('first'), { code: 'ETIMEDOUT' }),
  ])), 'timeout')
})

test('dependency checks enforce a bounded timeout without exposing error text', async () => {
  const status = await measureDependencyCheck(() => new Promise(() => undefined), 10)
  assert.equal(status.ok, false)
  assert.equal(status.error, 'timeout')
  assert(Number.isInteger(status.latencyMs))
  assert.equal(JSON.stringify(status).includes('Dependency health check timed out'), false)
})
