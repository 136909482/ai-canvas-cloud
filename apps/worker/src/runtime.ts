import { createJsonLogger, type Logger } from '@ai-canvas-cloud/shared'
import type { WorkerConfig } from './config.js'

interface WorkerRuntimeOptions {
  config: WorkerConfig
  logger?: Logger
}

export function createWorkerRuntime({
  config,
  logger = createJsonLogger({ level: config.logLevel, service: 'worker' }),
}: WorkerRuntimeOptions) {
  let heartbeat: NodeJS.Timeout | null = null
  let isRunning = false

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
      }, 30_000)
      heartbeat.unref()
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

      logger.info('worker.shutdown.completed', { signal })
    },
  }
}
