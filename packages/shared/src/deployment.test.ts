import assert from 'node:assert/strict'
import test from 'node:test'
import { validateProtectedDeploymentEnvironment } from './deployment.ts'

function baseEnv() {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'staging',
    DEPLOYMENT_ENV: 'staging',
    WEB_PUBLIC_URL: 'https://canvas-staging.example.com',
    BETTER_AUTH_URL: 'https://canvas-staging.example.com',
    WEB_ALLOWED_ORIGINS: 'https://canvas-staging.example.com',
    DATABASE_URL: 'postgres://staging-user:long-staging-password@staging-postgres:5432/ai_canvas_cloud_staging',
    REDIS_URL: 'rediss://staging-user:long-staging-password@staging-redis:6379/0',
    S3_ENDPOINT: 'https://staging-storage.example.com',
    S3_PUBLIC_ENDPOINT: 'https://staging-storage.example.com',
    S3_PUBLIC_ORIGIN: 'https://staging-storage.example.com',
    S3_BUCKET: 'ai-canvas-cloud-staging-assets',
    WORKER_TASK_QUEUE_NAME: 'ai-canvas-cloud-staging-generation',
    BETTER_AUTH_SECRET: 'a'.repeat(48),
    S3_ACCESS_KEY_ID: 'staging-access-key',
    S3_SECRET_ACCESS_KEY: 'staging-object-secret',
    PROVIDER_CREDENTIAL_KEYS: `1:${Buffer.alloc(32, 1).toString('base64')}`,
    AUTH_EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.staging.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_FROM: 'no-reply@staging.example.com',
    SMTP_USERNAME: 'staging-smtp-user',
    SMTP_PASSWORD: 'staging-smtp-password',
    DEPLOYMENT_RESOURCE_NAMESPACE: 'ai-canvas-cloud-staging',
    DEPLOYMENT_CREDENTIAL_NAMESPACE: 'ai-canvas-cloud-staging-credentials',
  }
  for (const key of ['DATABASE_RESOURCE_ID', 'REDIS_RESOURCE_ID', 'S3_RESOURCE_ID', 'MAIL_RESOURCE_ID', 'PROVIDER_RESOURCE_ID', 'PERSISTENCE_RESOURCE_ID', 'DATABASE_CREDENTIAL_ID', 'REDIS_CREDENTIAL_ID', 'S3_CREDENTIAL_ID', 'MAIL_CREDENTIAL_ID', 'PROVIDER_CREDENTIAL_ID', 'BYOK_KEYRING_ID']) {
    env[key] = `ai-canvas-cloud-staging-${key.toLowerCase()}`
  }
  return env
}

test('protected deployment accepts independently scoped staging resources', () => {
  assert.doesNotThrow(() => validateProtectedDeploymentEnvironment(baseEnv()))
})

test('protected deployment rejects local URLs, placeholders, missing origins and seed', () => {
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), WEB_PUBLIC_URL: 'http://localhost:5173' }), /HTTPS|localhost/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), BETTER_AUTH_SECRET: 'replace-with-a-long-random-secret' }), /placeholder/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), WEB_ALLOWED_ORIGINS: '' }), /WEB_ALLOWED_ORIGINS/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), DEV_SEED_ADMIN: 'true' }), /seed/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), S3_SECRET_ACCESS_KEY: 'minioadmin' }), /placeholder|default/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), S3_PUBLIC_ENDPOINT: 'http://storage.example.com' }), /S3_PUBLIC_ENDPOINT|HTTPS/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), S3_PUBLIC_ENDPOINT: 'https://localhost:9000' }), /S3_PUBLIC_ENDPOINT|localhost/)
  assert.throws(() => validateProtectedDeploymentEnvironment({ ...baseEnv(), S3_PUBLIC_ORIGIN: 'https://other-storage.example.com' }), /S3_PUBLIC_ORIGIN/)
})

test('protected deployment rejects identifiers shared with another environment', () => {
  assert.throws(() => validateProtectedDeploymentEnvironment({
    ...baseEnv(),
    REDIS_RESOURCE_ID: 'ai-canvas-cloud-production-redis',
  }), /staging|production environment/)
})
