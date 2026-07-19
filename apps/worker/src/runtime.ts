import { createJsonLogger, type Logger, type MetricsRegistry } from '@ai-canvas-cloud/shared'
import type { TaskQueueOutboxDispatcher } from '@ai-canvas-cloud/server'
import type { GenerationTaskExecutionService } from '@ai-canvas-cloud/server'
import type { WorkerConfig } from './config.js'
import type { TaskQueueConsumer } from './taskConsumer.js'

interface WorkerRuntimeOptions {
  config: WorkerConfig
  logger?: Logger
  dispatcher?: TaskQueueOutboxDispatcher
  taskExecutionService?: Pick<GenerationTaskExecutionService, 'recoverExpiredLeases'>
  taskConsumer?: TaskQueueConsumer
  closeResources?: () => Promise<void>
  metrics?: MetricsRegistry
}

export function createWorkerRuntime({
  config,
  logger = createJsonLogger({ level: config.logLevel, service: 'worker' }),
  dispatcher,
  taskExecutionService,
  taskConsumer,
  closeResources,
  metrics,
}: WorkerRuntimeOptions) {
  let heartbeat: NodeJS.Timeout | null = null
  let dispatchTimer: NodeJS.Timeout | null = null
  let dispatchInFlight: Promise<void> | null = null
  let recoveryTimer: NodeJS.Timeout | null = null
  let recoveryInFlight: Promise<void> | null = null
  let isRunning = false

  function dispatch() {
    if (!isRunning || !dispatcher || dispatchInFlight) {
      return
    }
    dispatchInFlight = dispatcher.dispatchOnce()
      .then((result) => {
        metrics?.increment('task_queue_dispatch_total', result.published, { outcome: 'published' })
        metrics?.increment('task_queue_dispatch_total', result.failed, { outcome: 'failed' })
        if (result.claimed > 0) {
          logger.info('worker.outbox.dispatched', {
            claimed: result.claimed,
            published: result.published,
            failed: result.failed,
          })
        }
      })
      .catch((error: unknown) => {
        metrics?.increment('worker_failures_total', 1, { component: 'outbox_dispatch' })
        logger.warn('worker.outbox.dispatch_failed', {
          error: error instanceof Error ? error.name : 'UnknownError',
        })
      })
      .finally(() => {
        dispatchInFlight = null
      })
  }

  function recoverExpiredLeases() {
    if (!isRunning || !taskExecutionService || recoveryInFlight) {
      return
    }
    recoveryInFlight = taskExecutionService.recoverExpiredLeases({
      batchSize: config.taskRecoveryBatchSize,
      retryBaseMs: config.taskRetryBaseMs,
      retryMaxMs: config.taskRetryMaxMs,
    })
      .then((result) => {
        if (result.recovered > 0) {
          logger.warn('worker.task_leases.recovered', {
            recovered: result.recovered,
            requeued: result.requeued,
            failed: result.failed,
            canceled: result.canceled,
          })
        }
      })
      .catch((error: unknown) => {
        metrics?.increment('worker_failures_total', 1, { component: 'lease_recovery' })
        logger.warn('worker.task_leases.recovery_failed', {
          error: error instanceof Error ? error.name : 'UnknownError',
        })
      })
      .finally(() => {
        recoveryInFlight = null
      })
  }

  return {
    start() {
      if (isRunning) {
        return
      }

      isRunning = true
      logger.info('worker.started', {
        env: config.env,
        s3Bucket: config.s3Bucket,
      })
      heartbeat = setInterval(() => {
        logger.debug('worker.heartbeat')
        if (metrics) logger.debug('worker.metrics', { snapshot: metrics.snapshot() })
      }, 30_000)
      heartbeat.unref()
      if (dispatcher) {
        dispatch()
        dispatchTimer = setInterval(dispatch, config.outboxDispatchIntervalMs)
        dispatchTimer.unref()
      }
      if (taskExecutionService) {
        recoverExpiredLeases()
        recoveryTimer = setInterval(recoverExpiredLeases, config.taskRecoveryIntervalMs)
        recoveryTimer.unref()
      }
      if (taskConsumer) {
        void taskConsumer.start().catch((error: unknown) => {
          metrics?.increment('worker_failures_total', 1, { component: 'queue_consumer' })
          logger.error('worker.task_consumer.start_failed', {
            error: error instanceof Error ? error.name : 'UnknownError',
          })
        })
      }
    },

    async stop(signal: NodeJS.Signals | 'manual') {
      if (!isRunning) {
        return
      }

      logger.info('worker.shutdown.started', { signal })
      isRunning = false

      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = null
      }
      if (dispatchTimer) {
        clearInterval(dispatchTimer)
        dispatchTimer = null
      }
      if (recoveryTimer) {
        clearInterval(recoveryTimer)
        recoveryTimer = null
      }
      await dispatchInFlight
      await recoveryInFlight
      await taskConsumer?.stop()
      await closeResources?.()

      logger.info('worker.shutdown.completed', { signal })
    },
  }
}
