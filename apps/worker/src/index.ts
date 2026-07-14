import { createJsonLogger } from '@ai-canvas-cloud/shared'
import { loadWorkerConfig } from './config.js'
import { createWorkerRuntime } from './runtime.js'

const config = loadWorkerConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'worker' })
const runtime = createWorkerRuntime({ config, logger })

let isClosing = false

async function shutdown(signal: NodeJS.Signals) {
  if (isClosing) {
    return
  }

  isClosing = true
  const timeout = setTimeout(() => {
    logger.error('worker.shutdown.timeout', { signal })
    process.exit(1)
  }, config.shutdownTimeoutMs)

  try {
    await runtime.stop(signal)
    clearTimeout(timeout)
    process.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    logger.error('worker.shutdown.failed', {
      signal,
      error: error instanceof Error ? error.message : String(error),
    })
    process.exit(1)
  }
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

runtime.start()
