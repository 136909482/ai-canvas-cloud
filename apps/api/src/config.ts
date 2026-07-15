import {
  readOptionalEnv,
  readPortEnv,
  readRequiredEnv,
  readPositiveIntegerEnv,
  type LogLevel,
} from '@ai-canvas-cloud/shared'

export interface ApiConfig {
  env: string
  logLevel: LogLevel
  host: string
  port: number
  shutdownTimeoutMs: number
  betterAuthUrl: string
  betterAuthSecret: string
  webPublicUrl: string
  databaseUrl: string
  redisUrl: string
  s3Endpoint: string
  s3Bucket: string
  s3Region: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  devSeedAdmin: boolean
  devSeedAdminEmail: string
  devSeedAdminPassword?: string
}

const logLevels = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])
const truthyEnvValues = new Set(['1', 'true', 'yes', 'on'])

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = readOptionalEnv(env, 'LOG_LEVEL', 'info')

  if (!logLevels.has(value as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${value}`)
  }

  return value as LogLevel
}

function readBooleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = env[key]

  if (!value || value.trim().length === 0) {
    return fallback
  }

  return truthyEnvValues.has(value.trim().toLowerCase())
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const appEnv = readOptionalEnv(env, 'NODE_ENV', 'development')

  return {
    env: appEnv,
    logLevel: readLogLevel(env),
    host: readOptionalEnv(env, 'API_HOST', '127.0.0.1'),
    port: readPortEnv(env, 'API_PORT', 8787),
    shutdownTimeoutMs: readPositiveIntegerEnv(env, 'API_SHUTDOWN_TIMEOUT_MS', 10_000),
    betterAuthUrl: readOptionalEnv(env, 'BETTER_AUTH_URL', `http://${readOptionalEnv(env, 'API_HOST', '127.0.0.1')}:${readPortEnv(env, 'API_PORT', 8787)}`),
    betterAuthSecret: readRequiredEnv(env, 'BETTER_AUTH_SECRET'),
    webPublicUrl: readOptionalEnv(env, 'WEB_PUBLIC_URL', 'http://localhost:5173'),
    databaseUrl: readRequiredEnv(env, 'DATABASE_URL'),
    redisUrl: readRequiredEnv(env, 'REDIS_URL'),
    s3Endpoint: readRequiredEnv(env, 'S3_ENDPOINT'),
    s3Bucket: readRequiredEnv(env, 'S3_BUCKET'),
    s3Region: readRequiredEnv(env, 'S3_REGION'),
    s3AccessKeyId: readRequiredEnv(env, 'S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: readRequiredEnv(env, 'S3_SECRET_ACCESS_KEY'),
    devSeedAdmin: appEnv !== 'production' && readBooleanEnv(env, 'DEV_SEED_ADMIN', false),
    devSeedAdminEmail: readOptionalEnv(env, 'DEV_SEED_ADMIN_EMAIL', 'admin@example.com'),
    devSeedAdminPassword: env.DEV_SEED_ADMIN_PASSWORD?.trim() || undefined,
  }
}
