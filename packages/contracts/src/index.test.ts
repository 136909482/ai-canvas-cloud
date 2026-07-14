import assert from 'node:assert/strict'
import test from 'node:test'
import { apiErrorCodes, createServiceUnavailableError } from './index.ts'

test('contracts expose stable API error codes', () => {
  assert(apiErrorCodes.includes('PROJECT_VERSION_CONFLICT'))
  assert.equal(createServiceUnavailableError('req_1').error.requestId, 'req_1')
})
