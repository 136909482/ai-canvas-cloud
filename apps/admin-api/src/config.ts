import { readOptionalEnv, readPortEnv, readPositiveIntegerEnv, readRequiredEnv, type LogLevel } from '@ai-canvas-cloud/shared'

export interface AdminApiConfig {
  env: string
  host: string
  port: number
  logLevel: LogLevel
  shutdownTimeoutMs: number
  trustProxy: boolean
  databaseUrl: string
  betterAuthUrl: string
  betterAuthSecret: string
  webPublicUrl: string
  allowedOrigins: string[]
  s3Endpoint: string
  s3PublicEndpoint: string
  s3Bucket: string
  s3Region: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
}

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on'])

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = env[key]?.trim().toLowerCase()
  return value ? TRUTHY_VALUES.has(value) : fallback
}

function parseOrigins(raw: string) {
  const origins = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  if (origins.length === 0) throw new Error('ADMIN_WEB_ALLOWED_ORIGINS must contain at least one origin')
  return origins.map((value) => {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`Invalid ADMIN_WEB_ALLOWED_ORIGINS origin: ${value}`)
    }
    return url.origin
  })
}

function databaseRole(url: string, key: string) {
  try {
    return decodeURIComponent(new URL(url).username)
  } catch {
    throw new Error(`${key} must be a valid PostgreSQL URL`)
  }
}

export function loadAdminApiConfig(env: NodeJS.ProcessEnv = process.env): AdminApiConfig {
  const appEnv = readOptionalEnv(env, 'NODE_ENV', 'development')
  const host = readOptionalEnv(env, 'ADMIN_API_HOST', '127.0.0.1')
  const port = readPortEnv(env, 'ADMIN_API_PORT', 8788)
  const databaseUrl = readRequiredEnv(env, 'ADMIN_DATABASE_URL')
  const ordinaryDatabaseUrl = readRequiredEnv(env, 'DATABASE_URL')
  const betterAuthSecret = readRequiredEnv(env, 'ADMIN_BETTER_AUTH_SECRET')
  const ordinaryAuthSecret = readRequiredEnv(env, 'BETTER_AUTH_SECRET')
  const webPublicUrl = readOptionalEnv(env, 'ADMIN_WEB_PUBLIC_URL', 'http://localhost:5174')
  const allowedOrigins = parseOrigins(readOptionalEnv(env, 'ADMIN_WEB_ALLOWED_ORIGINS', webPublicUrl))
  const logLevel = readOptionalEnv(env, 'LOG_LEVEL', 'info') as LogLevel
  if (!LOG_LEVELS.has(logLevel)) throw new Error(`Invalid LOG_LEVEL: ${logLevel}`)
  if (betterAuthSecret.length < 32 || betterAuthSecret === ordinaryAuthSecret) {
    throw new Error('ADMIN_BETTER_AUTH_SECRET must be at least 32 characters and independent from BETTER_AUTH_SECRET')
  }
  if (databaseRole(databaseUrl, 'ADMIN_DATABASE_URL') === databaseRole(ordinaryDatabaseUrl, 'DATABASE_URL')) {
    throw new Error('ADMIN_DATABASE_URL must use a database role distinct from DATABASE_URL')
  }
  const ordinaryOrigins = (env.WEB_ALLOWED_ORIGINS ?? env.WEB_PUBLIC_URL ?? '').split(',').map((value) => value.trim())
  if (allowedOrigins.some((origin) => ordinaryOrigins.includes(origin))) {
    throw new Error('Admin Web and ordinary Web origins must be distinct')
  }
  return {
    env: appEnv,
    host,
    port,
    logLevel,
    shutdownTimeoutMs: readPositiveIntegerEnv(env, 'ADMIN_API_SHUTDOWN_TIMEOUT_MS', 10_000),
    trustProxy: readBoolean(env, 'ADMIN_API_TRUST_PROXY', false),
    databaseUrl,
    betterAuthUrl: readOptionalEnv(env, 'ADMIN_BETTER_AUTH_URL', `http://${host}:${port}`),
    betterAuthSecret,
    webPublicUrl,
    allowedOrigins,
    s3Endpoint: readRequiredEnv(env, 'S3_ENDPOINT'),
    s3PublicEndpoint: readOptionalEnv(env, 'S3_PUBLIC_ENDPOINT', readRequiredEnv(env, 'S3_ENDPOINT')),
    s3Bucket: readRequiredEnv(env, 'S3_BUCKET'),
    s3Region: readRequiredEnv(env, 'S3_REGION'),
    s3AccessKeyId: readRequiredEnv(env, 'S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: readRequiredEnv(env, 'S3_SECRET_ACCESS_KEY'),
  }
}
