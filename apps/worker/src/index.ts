import {
  createPostgresPool,
  createPostgresGenerationTaskExecutionService,
  createPostgresTaskQueueOutboxDispatcher,
  createPostgresProviderCredentialService,
  createProviderAdapter,
  createProviderCredentialCipher,
  createS3ObjectStorage,
  loadDotEnv,
  parseProviderCredentialKeyring,
} from '@ai-canvas-cloud/server'
import { createJsonLogger, createMetricsRegistry } from '@ai-canvas-cloud/shared'
import { loadWorkerConfig } from './config.js'
import { createWorkerRuntime } from './runtime.js'
import { createBullMqTaskQueuePublisher } from './taskQueue.js'
import { createBullMqTaskQueueConsumer, createGenerationTaskJobProcessor } from './taskConsumer.js'
import { createProviderImageTaskProcessor } from './imageTaskProcessor.js'
import { closeWorkerObservabilityServer, createWorkerObservabilityServer } from './observability.js'

loadDotEnv()

const config = loadWorkerConfig()
const logger = createJsonLogger({ level: config.logLevel, service: 'worker' })
const metrics = createMetricsRegistry()
const dbPool = createPostgresPool({ connectionString: config.databaseUrl })
const taskQueuePublisher = createBullMqTaskQueuePublisher(config.redisUrl, config.taskQueueName)
const dispatcher = createPostgresTaskQueueOutboxDispatcher(dbPool, {
  owner: config.instanceId,
  publisher: taskQueuePublisher,
  batchSize: config.outboxBatchSize,
  claimTtlMs: config.outboxClaimTtlMs,
  retryBaseMs: config.outboxRetryBaseMs,
  retryMaxMs: config.outboxRetryMaxMs,
})
const taskExecutionService = createPostgresGenerationTaskExecutionService(dbPool, { metrics })
const objectStorage = createS3ObjectStorage({
  endpoint: config.s3Endpoint,
  bucket: config.s3Bucket,
  region: config.s3Region,
  accessKeyId: config.s3AccessKeyId,
  secretAccessKey: config.s3SecretAccessKey,
  forcePathStyle: true,
})
const providerAdapter = createProviderAdapter({ logger, metrics })
const providerCredentialService = createPostgresProviderCredentialService(dbPool, {
  adapter: providerAdapter,
  cipher: createProviderCredentialCipher(parseProviderCredentialKeyring(
    config.providerCredentialKeys,
    config.providerCredentialActiveKeyVersion,
  )),
})
const imageTaskProcessor = createProviderImageTaskProcessor({
  executionService: taskExecutionService,
  providerCredentialService,
  providerAdapter,
  objectStorage,
  metrics,
})
const taskConsumer = createBullMqTaskQueueConsumer({
  redisUrl: config.redisUrl,
  queueName: config.taskQueueName,
  concurrency: config.taskConcurrency,
  logger,
  jobProcessor: createGenerationTaskJobProcessor({
    executionService: taskExecutionService,
    processor: imageTaskProcessor,
    workerId: config.instanceId,
    leaseTtlMs: config.taskLeaseTtlMs,
    heartbeatMs: config.taskLeaseHeartbeatMs,
    retryDelayMs: config.taskRetryBaseMs,
  }),
})
const observabilityServer = createWorkerObservabilityServer({
  metrics,
  logger,
  checks: {
    async postgres() { await dbPool.query('SELECT 1') },
    redis: taskQueuePublisher.checkHealth,
    objectStorage: objectStorage.checkHealth,
  },
})
observabilityServer.listen(config.observabilityPort, config.observabilityHost, () => {
  logger.info('worker.observability.listening', {
    host: config.observabilityHost,
    port: config.observabilityPort,
  })
})
const runtime = createWorkerRuntime({
  config,
  logger,
  dispatcher,
  taskExecutionService,
  taskConsumer,
  metrics,
  async closeResources() {
    await closeWorkerObservabilityServer(observabilityServer)
    await taskQueuePublisher.close()
    await dbPool.end()
  },
})

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
      error: error instanceof Error ? error.name : 'UnknownError',
    })
    process.exit(1)
  }
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

runtime.start()
