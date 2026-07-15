import {
  createDevelopmentAuthEmailService,
  createPostgresAssetService,
  createPostgresAuthService,
  createPostgresPool,
  createPostgresProjectGraphService,
  createPostgresProjectSnapshotService,
  createPostgresProjectService,
  createS3ObjectStorage,
  createWorkspaceAuthorizationService,
  loadDotEnv,
  seedDevelopmentAdminAccount,
} from '@ai-canvas-cloud/server'
import { createJsonLogger } from '@ai-canvas-cloud/shared'
import { loadApiConfig } from './config.js'
import { closeApiServer, createApiServer } from './server.js'

loadDotEnv()

const config = loadApiConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'api' })
const dbPool = createPostgresPool({ connectionString: config.databaseUrl })
const authService = createPostgresAuthService(dbPool, {
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  publicWebUrl: config.webPublicUrl,
  emailService: createDevelopmentAuthEmailService({
    env: config.env,
    logger,
  }),
})
const workspaceAuthorizationService = createWorkspaceAuthorizationService(dbPool)
const objectStorage = createS3ObjectStorage({
  endpoint: config.s3Endpoint,
  bucket: config.s3Bucket,
  region: config.s3Region,
  accessKeyId: config.s3AccessKeyId,
  secretAccessKey: config.s3SecretAccessKey,
  forcePathStyle: true,
})
const assetService = createPostgresAssetService(dbPool, {
  authorizationService: workspaceAuthorizationService,
  objectStorage,
})
const projectGraphService = createPostgresProjectGraphService(dbPool, { authorizationService: workspaceAuthorizationService })
const projectSnapshotService = createPostgresProjectSnapshotService(dbPool, { authorizationService: workspaceAuthorizationService })
const projectService = createPostgresProjectService(dbPool, { authorizationService: workspaceAuthorizationService })
const server = createApiServer({
  config,
  logger,
  authService,
  assetService,
  projectGraphService,
  projectSnapshotService,
  projectService,
})

void seedDevelopmentAdminAccount({
  enabled: config.devSeedAdmin,
  env: config.env,
  email: config.devSeedAdminEmail,
  password: config.devSeedAdminPassword,
  authService,
  pool: dbPool,
  logger,
})

let isClosing = false

async function shutdown(signal: NodeJS.Signals) {
  if (isClosing) {
    return
  }

  isClosing = true
  logger.info('shutdown.started', { signal })

  try {
    await closeApiServer(server, config.shutdownTimeoutMs)
    await dbPool.end()
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
