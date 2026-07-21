import { Queue } from 'bullmq'
import { Redis, type RedisOptions } from 'ioredis'
import type { TaskQueueDispatchJob, TaskQueuePublisher } from '@ai-canvas-cloud/server'

export const DEFAULT_GENERATION_TASK_QUEUE_NAME = 'ai-canvas-generation'
const TASK_QUEUE_CONNECT_TIMEOUT_MS = 5_000

export function parseRedisConnectionOptions(redisUrl: string): RedisOptions {
  let url: URL
  try {
    url = new URL(redisUrl)
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL')
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://')
  }
  const databasePath = url.pathname.replace(/^\//, '')
  const database = databasePath ? Number(databasePath) : 0
  if (!Number.isInteger(database) || database < 0) {
    throw new Error('REDIS_URL database must be a non-negative integer')
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db: database,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}

export interface BullMqTaskQueuePublisher extends TaskQueuePublisher {
  checkHealth: () => Promise<void>
  close: () => Promise<void>
}

export function createBullMqTaskQueuePublisher(
  redisUrl: string,
  queueName = DEFAULT_GENERATION_TASK_QUEUE_NAME,
): BullMqTaskQueuePublisher {
  let connection: {
    queue: Queue<TaskQueueDispatchJob>
    redis: Redis
    lastError: Error | null
  } | null = null

  function getConnection() {
    if (connection) {
      return connection
    }
    const redis = new Redis({
      ...parseRedisConnectionOptions(redisUrl),
      lazyConnect: true,
    })
    const state = {
      queue: new Queue<TaskQueueDispatchJob>(queueName, {
        connection: redis,
        defaultJobOptions: {
          attempts: 20,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
        },
      }),
      redis,
      lastError: null as Error | null,
    }
    const captureError = (error: Error) => {
      state.lastError = error
    }
    state.redis.on('error', captureError)
    state.queue.on('error', captureError)
    connection = state
    return state
  }

  function resetConnection(state: NonNullable<typeof connection>) {
    if (connection === state) {
      connection = null
    }
    state.redis.disconnect(false)
  }

  async function waitUntilReady(state: NonNullable<typeof connection>) {
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        state.queue.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Task queue Redis connection timed out')), TASK_QUEUE_CONNECT_TIMEOUT_MS)
          timeout.unref()
        }),
      ])
    } catch (error) {
      throw state.lastError ?? error
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  async function waitForRedisConnection(state: NonNullable<typeof connection>) {
    if (state.redis.status === 'ready') return
    if (state.redis.status === 'wait') {
      await state.redis.connect()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        state.redis.off('ready', onReady)
        state.redis.off('error', onError)
      }
      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Task queue Redis connection timed out'))
      }, TASK_QUEUE_CONNECT_TIMEOUT_MS)
      timeout.unref()
      state.redis.once('ready', onReady)
      state.redis.once('error', onError)
    })
  }

  return {
    async checkHealth() {
      const state = getConnection()
      try {
        await waitForRedisConnection(state)
        await state.redis.ping()
      } catch (error) {
        resetConnection(state)
        throw state.lastError ?? error
      }
    },
    async publish(job) {
      const state = getConnection()
      try {
        await waitUntilReady(state)
        await state.queue.add('run-generation-task', job, { jobId: job.outboxId })
      } catch (error) {
        resetConnection(state)
        throw error
      }
    },
    async close() {
      const state = connection
      connection = null
      state?.redis.disconnect(false)
    },
  }
}
