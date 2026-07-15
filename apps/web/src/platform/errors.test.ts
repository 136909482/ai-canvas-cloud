import assert from 'node:assert/strict'
import test from 'node:test'
import { isProjectVersionConflictError, ProjectVersionConflictError } from './errors.ts'

test('identifies project version conflicts with server version details', () => {
  const error = new ProjectVersionConflictError({
    currentVersion: 7,
    currentSequence: 12,
  })

  assert.equal(isProjectVersionConflictError(error), true)
  assert.equal(error.currentVersion, 7)
  assert.equal(error.currentSequence, 12)
  assert.equal(isProjectVersionConflictError(new Error('other')), false)
})
