import assert from 'node:assert/strict'
import test from 'node:test'
import { loadApiConfig } from './config.ts'

const baseEnv = {
  BETTER_AUTH_SECRET: 'test-better-auth-secret-that-is-long-enough',
  DATABASE_URL: 'postgres://local',
  REDIS_URL: 'redis://local',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
}

test('API config validates required cloud dependencies', () => {
  const config = loadApiConfig(baseEnv)

  assert.equal(config.port, 8787)
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.betterAuthUrl, 'http://127.0.0.1:8787')
  assert.equal(config.webPublicUrl, 'http://localhost:5173')
  assert.equal(config.devSeedAdmin, false)
  assert.equal(config.devSeedAdminEmail, 'admin@example.com')
  assert.equal(config.s3Bucket, 'bucket')
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
    DEV_SEED_ADMIN: 'true',
    DEV_SEED_ADMIN_PASSWORD: 'local-only-password',
  }).devSeedAdmin, false)
})
