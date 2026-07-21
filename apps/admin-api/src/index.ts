import { createJsonLogger, measureDependencyCheck } from '@ai-canvas-cloud/shared'
import { createPostgresAdminService, createPostgresPool, loadDotEnv } from '@ai-canvas-cloud/server'
import { loadAdminApiConfig } from './config.js'
import { closeAdminApiServer, createAdminApiServer } from './server.js'

loadDotEnv()

const config = loadAdminApiConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'admin-api' })
const pool = createPostgresPool({ connectionString: config.databaseUrl, schema: 'admin' })
const adminService = createPostgresAdminService(pool, {
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  trustedOrigins: config.allowedOrigins,
  environment: config.env,
})
const server = createAdminApiServer({
  config,
  adminService,
  logger,
  readinessCheck: () => measureDependencyCheck(async () => { await pool.query('SELECT 1') }),
})

let closing = false
async function shutdown(signal: NodeJS.Signals) {
  if (closing) return
  closing = true
  logger.info('shutdown.started', { signal })
  try {
    await closeAdminApiServer(server, config.shutdownTimeoutMs)
    await pool.end()
    logger.info('shutdown.completed', { signal })
    process.exit(0)
  } catch (error) {
    logger.error('shutdown.failed', { signal, error: error instanceof Error ? error.name : 'UnknownError' })
    process.exit(1)
  }
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

server.listen(config.port, config.host, () => {
  logger.info('server.listening', { host: config.host, port: config.port, env: config.env })
})
