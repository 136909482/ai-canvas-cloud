import assert from 'node:assert/strict'
import test from 'node:test'
import { loadApiConfig } from './config.ts'

const baseEnv = {
  BETTER_AUTH_SECRET: 'test-better-auth-secret-that-is-long-enough',
  DATABASE_URL: 'postgres://local',
  REDIS_URL: 'redis://local',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
}

test('API config validates required cloud dependencies', () => {
  const config = loadApiConfig(baseEnv)

  assert.equal(config.port, 8787)
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.trustProxy, false)
  assert.equal(config.betterAuthUrl, 'http://127.0.0.1:8787')
  assert.equal(config.webPublicUrl, 'http://localhost:5173')
  assert.deepEqual(config.webAllowedOrigins, ['http://localhost:5173'])
  assert.equal(config.devSeedAdmin, false)
  assert.equal(config.devSeedAdminEmail, 'admin@example.com')
  assert.equal(config.s3Bucket, 'bucket')
  assert.equal(config.s3PublicEndpoint, 'http://localhost:9000')
})

test('API config rejects missing secrets and invalid log level', () => {
  assert.throws(() => loadApiConfig({ ...baseEnv, DATABASE_URL: '' }), /DATABASE_URL/)
  assert.throws(() => loadApiConfig({ ...baseEnv, LOG_LEVEL: 'trace' }), /LOG_LEVEL/)
})

test('API config reads development admin seed options outside production', () => {
  assert.equal(loadApiConfig({
    ...baseEnv,
    DEV_SEED_ADMIN: 'true',
    DEV_SEED_ADMIN_EMAIL: 'admin@local.test',
    DEV_SEED_ADMIN_PASSWORD: 'local-only-password',
  }).devSeedAdmin, true)

  assert.equal(loadApiConfig({
    ...baseEnv,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'production',
    WEB_PUBLIC_URL: 'https://cloud.example.com',
    BETTER_AUTH_URL: 'https://cloud.example.com',
    WEB_ALLOWED_ORIGINS: 'https://cloud.example.com',
    DATABASE_URL: 'postgres://prod-user:random-password@prod-postgres:5432/ai_canvas_cloud_production',
    REDIS_URL: 'rediss://prod-user:random-password@prod-redis:6379/0',
    S3_ENDPOINT: 'https://prod-storage.example.com',
    S3_PUBLIC_ENDPOINT: 'https://prod-storage.example.com',
    S3_PUBLIC_ORIGIN: 'https://prod-storage.example.com',
    S3_BUCKET: 'ai-canvas-cloud-production-assets',
    BETTER_AUTH_SECRET: 'a'.repeat(48),
    S3_ACCESS_KEY_ID: 'production-access-key',
    S3_SECRET_ACCESS_KEY: 'production-object-secret',
    AUTH_EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.production.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_FROM: 'no-reply@production.example.com',
    SMTP_USERNAME: 'production-smtp-user',
    SMTP_PASSWORD: 'production-smtp-password',
    DEPLOYMENT_RESOURCE_NAMESPACE: 'ai-canvas-cloud-production',
    DEPLOYMENT_CREDENTIAL_NAMESPACE: 'ai-canvas-cloud-production-credentials',
    DEV_SEED_ADMIN: 'false',
    DEV_SEED_ADMIN_EMAIL: undefined,
    DEV_SEED_ADMIN_PASSWORD: undefined,
    ...Object.fromEntries([
      'DATABASE_RESOURCE_ID', 'REDIS_RESOURCE_ID', 'S3_RESOURCE_ID', 'MAIL_RESOURCE_ID', 'PERSISTENCE_RESOURCE_ID',
      'DATABASE_CREDENTIAL_ID', 'REDIS_CREDENTIAL_ID', 'S3_CREDENTIAL_ID', 'MAIL_CREDENTIAL_ID',
    ].map((key) => [key, `ai-canvas-cloud-production-${key.toLowerCase()}`])),
  }).devSeedAdmin, false)
})

test('API config normalizes and validates the explicit web origin allowlist', () => {
  const config = loadApiConfig({
    ...baseEnv,
    WEB_PUBLIC_URL: 'https://cloud.example.com',
    WEB_ALLOWED_ORIGINS: 'https://cloud.example.com, https://studio.example.com/,https://cloud.example.com',
  })
  assert.deepEqual(config.webAllowedOrigins, ['https://cloud.example.com', 'https://studio.example.com'])
  assert.throws(() => loadApiConfig({ ...baseEnv, WEB_ALLOWED_ORIGINS: 'https://cloud.example.com/app' }), /without paths/)
  assert.throws(() => loadApiConfig({ ...baseEnv, WEB_ALLOWED_ORIGINS: 'http://user:pass@example.com' }), /Invalid WEB_ALLOWED_ORIGINS/)
})
