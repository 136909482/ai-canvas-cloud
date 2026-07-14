import assert from 'node:assert/strict'
import test from 'node:test'
import { readOptionalEnv, readPortEnv, readRequiredEnv } from './index.ts'

test('environment helpers validate required values and ports', () => {
  assert.equal(readRequiredEnv({ DATABASE_URL: ' postgres://local ' }, 'DATABASE_URL'), 'postgres://local')
  assert.equal(readOptionalEnv({}, 'LOG_LEVEL', 'info'), 'info')
  assert.equal(readPortEnv({ API_PORT: '8787' }, 'API_PORT', 3000), 8787)
  assert.throws(() => readRequiredEnv({}, 'DATABASE_URL'), /DATABASE_URL/)
  assert.throws(() => readPortEnv({ API_PORT: '70000' }, 'API_PORT', 3000), /API_PORT/)
})
