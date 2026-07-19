import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import type {
  GenerationTaskExecutionService,
  GenerationTaskLease,
  TaskQueueDispatchJob,
} from '@ai-canvas-cloud/server'
import type { Logger } from '@ai-canvas-cloud/shared'
import { parseRedisConnectionOptions } from './taskQueue.js'

export class GenerationTaskProcessingError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = true) {
    super(message)
    this.name = 'GenerationTaskProcessingError'
    this.code = code
    this.retryable = retryable
  }
}

export interface GenerationTaskProcessorContext {
  signal: AbortSignal
  reportProgress: (progress: number) => Promise<void>
}

export interface GenerationTaskProcessor {
  process: (lease: GenerationTaskLease, context: GenerationTaskProcessorContext) => Promise<void>
}

export interface GenerationTaskJobProcessor {
  process: (job: Pick<Job<TaskQueueDispatchJob>, 'id' | 'name' | 'data'>) => Promise<void>
  abortAll: () => void
}

export interface TaskQueueConsumer {
  start: () => Promise<void>
  stop: () => Promise<void>
}

interface ActiveTask {
  controller: AbortController
  shutdownRequested: boolean
}

function isDispatchJob(value: unknown): value is TaskQueueDispatchJob {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'outboxId' in value
    && typeof value.outboxId === 'string'
    && 'taskId' in value
    && typeof value.taskId === 'string',
  )
}

function classifyProcessingError(error: unknown) {
  if (error instanceof GenerationTaskProcessingError) {
    return { retryable: error.retryable, errorCode: error.code, errorMessage: error.message }
  }
  return {
    retryable: true,
    errorCode: 'WORKER_PROCESSOR_FAILED',
    errorMessage: error instanceof Error ? error.message : 'Task processor failed',
  }
}

export function createGenerationTaskJobProcessor(options: {
  executionService: GenerationTaskExecutionService
  processor: GenerationTaskProcessor
  workerId: string
  leaseTtlMs: number
  heartbeatMs: number
  retryDelayMs: number
}): GenerationTaskJobProcessor {
  const activeTasks = new Map<string, ActiveTask>()

  return {
    async process(job) {
      if (job.name !== 'run-generation-task' || !isDispatchJob(job.data)) {
        throw new Error('Invalid generation task queue job')
      }
      const lease = await options.executionService.claimTask({
        taskId: job.data.taskId,
        workerId: options.workerId,
        leaseTtlMs: options.leaseTtlMs,
      })
      if (!lease) {
        return
      }

      const activeTask: ActiveTask = {
        controller: new AbortController(),
        shutdownRequested: false,
      }
      activeTasks.set(lease.taskId, activeTask)
      let cancelRequested = false
      let leaseLost = false
      let heartbeatInFlight: Promise<void> | null = null

      const applyLeaseState = (state: Awaited<ReturnType<GenerationTaskExecutionService['renewLease']>>) => {
        if (!state.renewed) {
          leaseLost = true
          activeTask.controller.abort('lease-lost')
        } else if (state.cancelRequested) {
          cancelRequested = true
          activeTask.controller.abort('canceled')
        }
      }
      const heartbeat = () => {
        if (heartbeatInFlight || activeTask.controller.signal.aborted) {
          return
        }
        heartbeatInFlight = options.executionService.renewLease({
          taskId: lease.taskId,
          workerId: lease.workerId,
          leaseToken: lease.leaseToken,
          leaseTtlMs: options.leaseTtlMs,
        })
          .then(applyLeaseState)
          .catch(() => {
            leaseLost = true
            activeTask.controller.abort('lease-renewal-failed')
          })
          .finally(() => {
            heartbeatInFlight = null
          })
      }
      const heartbeatTimer = setInterval(heartbeat, options.heartbeatMs)
      heartbeatTimer.unref()

      try {
        await options.processor.process(lease, {
          signal: activeTask.controller.signal,
          async reportProgress(progress) {
            const state = await options.executionService.updateProgress({
              taskId: lease.taskId,
              workerId: lease.workerId,
              leaseToken: lease.leaseToken,
              progress,
              leaseTtlMs: options.leaseTtlMs,
            })
            applyLeaseState(state)
          },
        })

        const state = await options.executionService.renewLease({
          taskId: lease.taskId,
          workerId: lease.workerId,
          leaseToken: lease.leaseToken,
          leaseTtlMs: options.leaseTtlMs,
        })
        if (state.cancelRequested) {
          cancelRequested = true
        }
        if (state.renewed) {
          if (cancelRequested) {
            await options.executionService.settleCanceled({
              taskId: lease.taskId,
              workerId: lease.workerId,
              leaseToken: lease.leaseToken,
            })
          } else {
            await options.executionService.settleFailure({
              taskId: lease.taskId,
              workerId: lease.workerId,
              leaseToken: lease.leaseToken,
              retryable: activeTask.shutdownRequested,
              errorCode: activeTask.shutdownRequested ? 'WORKER_SHUTDOWN' : 'WORKER_PROCESSOR_INCOMPLETE',
              errorMessage: activeTask.shutdownRequested
                ? 'Worker stopped before the task completed'
                : 'Task processor returned without settling the running task',
              retryDelayMs: options.retryDelayMs,
            })
          }
        }
      } catch (error) {
        if (cancelRequested) {
          await options.executionService.settleCanceled({
            taskId: lease.taskId,
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
          })
        } else if (!leaseLost) {
          const failure = activeTask.shutdownRequested
            ? {
                retryable: true,
                errorCode: 'WORKER_SHUTDOWN',
                errorMessage: 'Worker stopped before the task completed',
              }
            : classifyProcessingError(error)
          await options.executionService.settleFailure({
            taskId: lease.taskId,
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
            ...failure,
            retryDelayMs: options.retryDelayMs,
          })
        }
      } finally {
        clearInterval(heartbeatTimer)
        await heartbeatInFlight
        activeTasks.delete(lease.taskId)
      }
    },

    abortAll() {
      for (const activeTask of activeTasks.values()) {
        activeTask.shutdownRequested = true
        activeTask.controller.abort('shutdown')
      }
    },
  }
}

export function createBullMqTaskQueueConsumer(options: {
  redisUrl: string
  queueName: string
  concurrency: number
  logger: Logger
  jobProcessor: GenerationTaskJobProcessor
}): TaskQueueConsumer {
  const workerRedis = new Redis({
    ...parseRedisConnectionOptions(options.redisUrl),
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
  })
  const controlRedis = new Redis({
    ...parseRedisConnectionOptions(options.redisUrl),
    lazyConnect: true,
  })
  const controlQueue = new Queue(options.queueName, { connection: controlRedis })
  const worker = new Worker<TaskQueueDispatchJob>(
    options.queueName,
    (job) => options.jobProcessor.process(job),
    {
      autorun: false,
      concurrency: options.concurrency,
      connection: workerRedis,
    },
  )
  let runPromise: Promise<void> | null = null

  worker.on('error', (error) => {
    options.logger.error('worker.task_consumer.error', {
      error: error.name,
    })
  })
  worker.on('failed', (job, error) => {
    options.logger.warn('worker.task_consumer.job_failed', {
      jobId: job?.id ?? null,
      taskId: job?.data.taskId ?? null,
      error: error.name,
    })
  })

  return {
    async start() {
      if (runPromise) {
        return
      }
      await controlQueue.setGlobalConcurrency(options.concurrency)
      runPromise = worker.run().catch((error: unknown) => {
        options.logger.error('worker.task_consumer.stopped_unexpectedly', {
          error: error instanceof Error ? error.name : 'UnknownError',
        })
      })
    },

    async stop() {
      options.jobProcessor.abortAll()
      await worker.close()
      await runPromise
      runPromise = null
      controlRedis.disconnect(false)
      workerRedis.disconnect(false)
    },
  }
}
