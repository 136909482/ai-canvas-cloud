import { createJsonLogger } from '@ai-canvas-cloud/shared'
import { loadApiConfig } from './config.js'
import { closeApiServer, createApiServer } from './server.js'

const config = loadApiConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'api' })
const server = createApiServer({ config, logger })

let isClosing = false

async function shutdown(signal: NodeJS.Signals) {
  if (isClosing) {
    return
  }

  isClosing = true
  logger.info('shutdown.started', { signal })

  try {
    await closeApiServer(server, config.shutdownTimeoutMs)
    logger.info('shutdown.completed', { signal })
    process.exit(0)
  } catch (error) {
    logger.error('shutdown.failed', {
      signal,
      error: error instanceof Error ? error.message : String(error),
    })
    process.exit(1)
  }
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

server.listen(config.port, config.host, () => {
  logger.info('server.listening', {
    host: config.host,
    port: config.port,
    env: config.env,
  })
})
