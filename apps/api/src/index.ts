import {
  createDevelopmentAuthEmailService,
  createSmtpAuthEmailService,
  createPostgresAssetService,
  createPostgresAuthService,
  createPostgresPool,
  createPostgresProjectGraphService,
  createPostgresProjectSnapshotService,
  createPostgresProjectService,
  createS3ObjectStorage,
  createWorkspaceAuthorizationService,
  createPostgresWorkspaceUsageService,
  createPostgresProviderCredentialService,
  createProviderAdapter,
  createProviderCredentialCipher,
  parseProviderCredentialKeyring,
  createPostgresGenerationTaskService,
  createPostgresMigrationImportService,
  createPostgresMigrationAssetUploadService,
  createPostgresMigrationExportService,
  loadDotEnv,
  seedDevelopmentAdminAccount,
} from '@ai-canvas-cloud/server'
import { createJsonLogger, createMetricsRegistry } from '@ai-canvas-cloud/shared'
import { loadApiConfig } from './config.js'
import { closeApiServer, createApiServer } from './server.js'
import { createRedisRateLimiter } from './rateLimit.js'

loadDotEnv()

const config = loadApiConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'api' })
const metrics = createMetricsRegistry()
const dbPool = createPostgresPool({ connectionString: config.databaseUrl })
const rateLimiter = createRedisRateLimiter(config.redisUrl, config.env)
const authEmailService = config.authEmailTransport === 'smtp'
  ? createSmtpAuthEmailService({
      host: config.smtpHost!,
      port: config.smtpPort!,
      secure: config.smtpSecure,
      from: config.smtpFrom!,
      username: config.smtpUsername!,
      password: config.smtpPassword!,
    })
  : createDevelopmentAuthEmailService({
      env: config.env,
      logger,
    })
const authService = createPostgresAuthService(dbPool, {
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  publicWebUrl: config.webPublicUrl,
  trustedOrigins: config.webAllowedOrigins,
  environment: config.env,
  emailService: authEmailService,
})
const workspaceAuthorizationService = createWorkspaceAuthorizationService(dbPool)
const objectStorage = createS3ObjectStorage({
  endpoint: config.s3Endpoint,
  publicEndpoint: config.s3PublicEndpoint,
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
const workspaceUsageService = createPostgresWorkspaceUsageService(dbPool, { authorizationService: workspaceAuthorizationService })
const providerCredentialService = createPostgresProviderCredentialService(dbPool, {
  authorizationService: workspaceAuthorizationService,
  adapter: createProviderAdapter({ logger, metrics }),
  cipher: createProviderCredentialCipher(parseProviderCredentialKeyring(
    config.providerCredentialKeys,
    config.providerCredentialActiveKeyVersion,
  )),
})
const generationTaskService = createPostgresGenerationTaskService(dbPool, {
  authorizationService: workspaceAuthorizationService,
})
const migrationImportService = createPostgresMigrationImportService(dbPool, {
  authorizationService: workspaceAuthorizationService,
})
const migrationAssetUploadService = createPostgresMigrationAssetUploadService(dbPool, objectStorage, {
  authorizationService: workspaceAuthorizationService,
})
const migrationExportService = createPostgresMigrationExportService(dbPool, objectStorage, {
  authorizationService: workspaceAuthorizationService,
})
const server = createApiServer({
  config,
  logger,
  authService,
  assetService,
  projectGraphService,
  projectSnapshotService,
  projectService,
  workspaceUsageService,
  providerCredentialService,
  generationTaskService,
  migrationImportService,
  migrationAssetUploadService,
  migrationExportService,
  metrics,
  postgresPoolStats: () => ({
    total: dbPool.totalCount,
    idle: dbPool.idleCount,
    waiting: dbPool.waitingCount,
  }),
  rateLimiter,
  readinessChecks: {
    async postgres() { await dbPool.query('SELECT 1') },
    objectStorage: objectStorage.checkHealth,
    redis: rateLimiter.ping,
  },
})
void migrationExportService.recoverExports().catch(() => undefined)
void migrationAssetUploadService.maintainStagingObjects().catch(() => undefined)
const migrationMaintenanceTimer = setInterval(() => {
  void migrationExportService.maintainExports().catch(() => undefined)
  void migrationAssetUploadService.maintainStagingObjects().catch(() => undefined)
}, 15 * 60 * 1000)
migrationMaintenanceTimer.unref()

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
  clearInterval(migrationMaintenanceTimer)

  try {
    await closeApiServer(server, config.shutdownTimeoutMs)
    await rateLimiter.close()
    await dbPool.end()
    logger.info('shutdown.completed', { signal })
    process.exit(0)
  } catch (error) {
    logger.error('shutdown.failed', {
      signal,
      error: error instanceof Error ? error.name : 'UnknownError',
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
