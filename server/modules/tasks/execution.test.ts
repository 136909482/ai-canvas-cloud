import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateTaskExecutionRetryDelay,
  createPostgresGenerationTaskExecutionService,
} from '../../dist/modules/tasks/execution.js'

test('task execution retry delay is exponential and capped', () => {
  assert.equal(calculateTaskExecutionRetryDelay(1, 100, 1_000), 100)
  assert.equal(calculateTaskExecutionRetryDelay(2, 100, 1_000), 200)
  assert.equal(calculateTaskExecutionRetryDelay(8, 100, 1_000), 1_000)
  assert.throws(() => calculateTaskExecutionRetryDelay(0), /attemptCount/)
  assert.throws(() => calculateTaskExecutionRetryDelay(1, 2_000, 1_000), /must not exceed/)
})

test('task execution service validates worker-controlled inputs before querying', async () => {
  const service = createPostgresGenerationTaskExecutionService({} as never)

  await assert.rejects(
    () => service.claimTask({ taskId: 'bad', workerId: 'worker' }),
    /taskId/,
  )
  await assert.rejects(
    () => service.claimTask({ taskId: '11111111-1111-4111-8111-111111111111', workerId: ' ' }),
    /workerId/,
  )
  await assert.rejects(
    () => service.settleFailure({
      taskId: '11111111-1111-4111-8111-111111111111',
      workerId: 'worker',
      leaseToken: '22222222-2222-4222-8222-222222222222',
      retryable: true,
      errorCode: 'unsafe-code',
      errorMessage: 'failed',
    }),
    /errorCode/,
  )
})
