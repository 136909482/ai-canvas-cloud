import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Queue } from 'bullmq'
import { loadDotEnv } from '@ai-canvas-cloud/server'
import {
  createBullMqTaskQueuePublisher,
  parseRedisConnectionOptions,
} from './taskQueue.ts'
import { createBullMqTaskQueueConsumer } from '../dist/taskConsumer.js'

loadDotEnv()

const redisUrl = process.env.REDIS_URL

test('BullMQ publisher keeps duplicate outbox delivery idempotent in Redis', {
  skip: redisUrl ? false : 'REDIS_URL is not configured',
}, async (context) => {
  const queueName = `ai-canvas-outbox-test-${randomUUID()}`
  let publisher = createBullMqTaskQueuePublisher(redisUrl!, queueName)
  let inspectionQueue: Queue | null = null
  let consumer: ReturnType<typeof createBullMqTaskQueueConsumer> | null = null
  const job = { outboxId: randomUUID(), taskId: randomUUID() }

  try {
    try {
      await publisher.publish(job)
      await publisher.close()
      publisher = createBullMqTaskQueuePublisher(redisUrl!, queueName)
      await publisher.publish(job)
    } catch (error) {
      if (error instanceof Error && /NOAUTH|WRONGPASS|Authentication required|Connection is closed|ECONNREFUSED|timed out/i.test(error.message)) {
        context.skip('The configured Redis server is unavailable or rejected REDIS_URL credentials')
        return
      }
      throw error
    }
    inspectionQueue = new Queue(queueName, {
      connection: parseRedisConnectionOptions(redisUrl!),
    })
    inspectionQueue.on('error', () => {})
    const waiting = await inspectionQueue.getJobs(['waiting'])

    assert.equal(waiting.length, 1)
    assert.equal(waiting[0]?.id, job.outboxId)
    assert.deepEqual(waiting[0]?.data, job)
    const consumed = Promise.withResolvers<string>()
    consumer = createBullMqTaskQueueConsumer({
      redisUrl: redisUrl!,
      queueName,
      concurrency: 1,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      jobProcessor: {
        async process(queuedJob) {
          consumed.resolve(queuedJob.data.taskId)
        },
        abortAll() {},
      },
    })
    await consumer.start()
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('BullMQ consumer timed out')), 5_000)
      timer.unref()
    })
    const consumedTaskId = await Promise.race([
      consumed.promise,
      timeout,
    ])
    assert.equal(consumedTaskId, job.taskId)
  } finally {
    await consumer?.stop()
    await publisher.close()
    await inspectionQueue?.obliterate({ force: true }).catch(() => undefined)
    await inspectionQueue?.disconnect()
  }
})
