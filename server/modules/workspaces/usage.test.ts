import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES,
  calculateWorkspaceStorageUsage,
} from '../../dist/modules/workspaces/usage.js'

test('workspace storage usage keeps stored and pending reservation bytes explicit', () => {
  const response = calculateWorkspaceStorageUsage({
    workspaceId: 'workspace_1',
    quotaBytes: DEFAULT_PERSONAL_WORKSPACE_STORAGE_QUOTA_BYTES,
    usedBytes: 1024,
    reservedBytes: 512,
  })

  assert.equal(response.storage.quotaBytes, 20 * 1024 * 1024 * 1024)
  assert.equal(response.storage.totalBytes, 1536)
  assert.equal(response.storage.availableBytes, response.storage.quotaBytes - 1536)
})

test('workspace storage usage never reports negative available bytes', () => {
  const response = calculateWorkspaceStorageUsage({
    workspaceId: 'workspace_1',
    quotaBytes: 100,
    usedBytes: 120,
    reservedBytes: 10,
  })

  assert.equal(response.storage.totalBytes, 130)
  assert.equal(response.storage.availableBytes, 0)
})
