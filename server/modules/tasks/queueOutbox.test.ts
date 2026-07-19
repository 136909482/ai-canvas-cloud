import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateTaskQueueRetryDelay,
  createPostgresTaskQueueOutboxDispatcher,
} from '../../dist/modules/tasks/queueOutbox.js'

test('task queue retry delay grows exponentially and stays capped', () => {
  assert.equal(calculateTaskQueueRetryDelay(1, 100, 1_000), 100)
  assert.equal(calculateTaskQueueRetryDelay(2, 100, 1_000), 200)
  assert.equal(calculateTaskQueueRetryDelay(8, 100, 1_000), 1_000)
})

test('task queue dispatcher validates bounds before accessing PostgreSQL', () => {
  const pool = {} as never
  const publisher = { async publish() {} }

  assert.throws(
    () => createPostgresTaskQueueOutboxDispatcher(pool, { owner: '', publisher }),
    /dispatcher owner/,
  )
  assert.throws(
    () => createPostgresTaskQueueOutboxDispatcher(pool, { owner: 'worker', publisher, batchSize: 101 }),
    /batch size/,
  )
  assert.throws(
    () => createPostgresTaskQueueOutboxDispatcher(pool, {
      owner: 'worker', publisher, retryBaseMs: 2_000, retryMaxMs: 1_000,
    }),
    /retry base/,
  )
})
