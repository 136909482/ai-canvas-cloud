import {
  readOptionalEnv,
  readPortEnv,
  readPositiveIntegerEnv,
  readRequiredEnv,
  validateProtectedDeploymentEnvironment,
  type LogLevel,
} from '@ai-canvas-cloud/shared'
import { hostname } from 'node:os'

export interface WorkerConfig {
  env: string
  logLevel: LogLevel
  shutdownTimeoutMs: number
  observabilityHost: string
  observabilityPort: number
  databaseUrl: string
  redisUrl: string
  s3Endpoint: string
  s3Bucket: string
  s3Region: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  providerCredentialKeys: string
  providerCredentialActiveKeyVersion: number
  instanceId: string
  taskQueueName: string
  outboxDispatchIntervalMs: number
  outboxBatchSize: number
  outboxClaimTtlMs: number
  outboxRetryBaseMs: number
  outboxRetryMaxMs: number
  taskConcurrency: number
  taskLeaseTtlMs: number
  taskLeaseHeartbeatMs: number
  taskRecoveryIntervalMs: number
  taskRecoveryBatchSize: number
  taskRetryBaseMs: number
  taskRetryMaxMs: number
}

const logLevels = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = readOptionalEnv(env, 'LOG_LEVEL', 'info')

  if (!logLevels.has(value as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${value}`)
  }

  return value as LogLevel
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  validateProtectedDeploymentEnvironment(env, { requireWeb: false, requireMail: false })
  const outboxRetryBaseMs = readPositiveIntegerEnv(env, 'WORKER_OUTBOX_RETRY_BASE_MS', 1_000)
  const outboxRetryMaxMs = readPositiveIntegerEnv(env, 'WORKER_OUTBOX_RETRY_MAX_MS', 60_000)
  if (outboxRetryBaseMs > outboxRetryMaxMs) {
    throw new Error('WORKER_OUTBOX_RETRY_BASE_MS must not exceed WORKER_OUTBOX_RETRY_MAX_MS')
  }
  const taskLeaseTtlMs = readPositiveIntegerEnv(env, 'WORKER_TASK_LEASE_TTL_MS', 30_000)
  const taskLeaseHeartbeatMs = readPositiveIntegerEnv(env, 'WORKER_TASK_LEASE_HEARTBEAT_MS', 10_000)
  if (taskLeaseHeartbeatMs >= taskLeaseTtlMs) {
    throw new Error('WORKER_TASK_LEASE_HEARTBEAT_MS must be below WORKER_TASK_LEASE_TTL_MS')
  }
  const taskRetryBaseMs = readPositiveIntegerEnv(env, 'WORKER_TASK_RETRY_BASE_MS', 5_000)
  const taskRetryMaxMs = readPositiveIntegerEnv(env, 'WORKER_TASK_RETRY_MAX_MS', 300_000)
  if (taskRetryBaseMs > taskRetryMaxMs) {
    throw new Error('WORKER_TASK_RETRY_BASE_MS must not exceed WORKER_TASK_RETRY_MAX_MS')
  }

  return {
    env: readOptionalEnv(env, 'NODE_ENV', 'development'),
    logLevel: readLogLevel(env),
    shutdownTimeoutMs: readPositiveIntegerEnv(env, 'WORKER_SHUTDOWN_TIMEOUT_MS', 10_000),
    observabilityHost: readOptionalEnv(env, 'WORKER_OBSERVABILITY_HOST', '127.0.0.1'),
    observabilityPort: readPortEnv(env, 'WORKER_OBSERVABILITY_PORT', 8790),
    databaseUrl: readRequiredEnv(env, 'DATABASE_URL'),
    redisUrl: readRequiredEnv(env, 'REDIS_URL'),
    s3Endpoint: readRequiredEnv(env, 'S3_ENDPOINT'),
    s3Bucket: readRequiredEnv(env, 'S3_BUCKET'),
    s3Region: readRequiredEnv(env, 'S3_REGION'),
    s3AccessKeyId: readRequiredEnv(env, 'S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: readRequiredEnv(env, 'S3_SECRET_ACCESS_KEY'),
    providerCredentialKeys: readRequiredEnv(env, 'PROVIDER_CREDENTIAL_KEYS'),
    providerCredentialActiveKeyVersion: readPositiveIntegerEnv(env, 'PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION', 1),
    instanceId: readOptionalEnv(env, 'WORKER_INSTANCE_ID', `${hostname()}-${process.pid}`),
    taskQueueName: readOptionalEnv(env, 'WORKER_TASK_QUEUE_NAME', 'ai-canvas-generation'),
    outboxDispatchIntervalMs: readPositiveIntegerEnv(env, 'WORKER_OUTBOX_DISPATCH_INTERVAL_MS', 1_000),
    outboxBatchSize: readPositiveIntegerEnv(env, 'WORKER_OUTBOX_BATCH_SIZE', 25),
    outboxClaimTtlMs: readPositiveIntegerEnv(env, 'WORKER_OUTBOX_CLAIM_TTL_MS', 30_000),
    outboxRetryBaseMs,
    outboxRetryMaxMs,
    taskConcurrency: readPositiveIntegerEnv(env, 'WORKER_TASK_CONCURRENCY', 5),
    taskLeaseTtlMs,
    taskLeaseHeartbeatMs,
    taskRecoveryIntervalMs: readPositiveIntegerEnv(env, 'WORKER_TASK_RECOVERY_INTERVAL_MS', 15_000),
    taskRecoveryBatchSize: readPositiveIntegerEnv(env, 'WORKER_TASK_RECOVERY_BATCH_SIZE', 25),
    taskRetryBaseMs,
    taskRetryMaxMs,
  }
}
