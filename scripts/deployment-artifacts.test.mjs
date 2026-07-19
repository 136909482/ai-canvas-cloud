import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dockerfile = readFileSync('Dockerfile', 'utf8')
const dockerignore = readFileSync('.dockerignore', 'utf8')
const compose = readFileSync('infra/deploy/staging/docker-compose.yml', 'utf8')
const template = readFileSync('infra/deploy/staging/staging.env.example', 'utf8')
const nginx = readFileSync('infra/deploy/staging/web.nginx.conf', 'utf8')
const prometheus = readFileSync('infra/deploy/staging/prometheus.yml', 'utf8')
const alerts = readFileSync('infra/deploy/staging/alerts.yml', 'utf8')
const applyMigrations = readFileSync('scripts/apply-migrations.mjs', 'utf8')
const releaseManifest = readFileSync('server/db/migrations/release-manifest.json', 'utf8')

test('deployment artifacts keep runtime targets non-root and migration explicit', () => {
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS api/)
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS worker/)
  assert.match(dockerfile, /FROM nginxinc\/nginx-unprivileged:1\.29\.1-alpine AS web/)
  assert.equal((dockerfile.match(/USER node/g) ?? []).length, 4)
  assert.match(dockerignore, /infra\/deploy\/staging\/staging\.env/)
  assert.match(compose, /profiles: \["release"\]/)
  assert.match(compose, /staging-postgres-data/)
  assert.match(compose, /staging-redis-data/)
  assert.match(compose, /staging-object-storage-data/)
  assert.doesNotMatch(compose, /npm run db:migrate|apply-migrations\.mjs.*api|apply-migrations\.mjs.*worker/)
})

test('staging environment template contains placeholders and no local defaults', () => {
  assert.match(template, /replace-with-staging-random-secret/)
  assert.match(template, /ai-canvas-cloud-staging-generation/)
  assert.doesNotMatch(template, /minioadmin|localhost:|127\.0\.0\.1|DEV_SEED_ADMIN=/)
})

test('staging web and object storage boundaries are explicit and origin-scoped', () => {
  assert.match(nginx, /Content-Security-Policy/)
  assert.match(nginx, /frame-ancestors 'none'/)
  assert.match(nginx, /connect-src 'self' \$\{S3_PUBLIC_ORIGIN\}/)
  assert.doesNotMatch(nginx, /unsafe-eval/)
  assert.match(nginx, /client_max_body_size 8m/)
  assert.match(nginx, /expires 1y/)
  assert.match(compose, /mc cors set/)
  assert.match(compose, /ExposeHeaders.*ETag/)
  assert.match(compose, /mc anonymous set none/)
  assert.match(template, /S3_PUBLIC_ENDPOINT=https:\/\/staging-storage\.replace-with-real-domain/)
  assert.match(template, /S3_PUBLIC_ORIGIN=https:\/\/staging-storage\.replace-with-real-domain/)
})

test('staging monitoring scrapes API and Worker and keeps alerts low-cardinality', () => {
  assert.match(compose, /prom\/prometheus:v3\.5\.0/)
  assert.match(compose, /staging-prometheus-data/)
  assert.match(prometheus, /targets: \[api:8787\]/)
  assert.match(prometheus, /targets: \[worker:8790\]/)
  assert.match(alerts, /AiCanvasDependencyDown/)
  assert.match(alerts, /AiCanvasTaskBacklogHigh/)
  assert.match(alerts, /AiCanvasProviderFailures/)
  assert.doesNotMatch(alerts, /workspace_id|user_id|project_id|task_id|request_id|email|url=/i)
})

test('staging recovery keeps encrypted backups and restore resources isolated', () => {
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS operations/)
  assert.match(dockerfile, /USER node[\s\S]*VOLUME \["\/backups"\]/)
  assert.match(compose, /backup-scheduler:/)
  assert.match(compose, /restore-postgres:/)
  assert.match(compose, /restore-redis:/)
  assert.match(compose, /restore-object-storage:/)
  assert.match(compose, /profiles: \["restore"\]/)
  assert.match(compose, /staging-restore-postgres-data/)
  assert.match(compose, /staging-restore-redis-data/)
  assert.match(compose, /staging-restore-object-data/)
  assert.match(prometheus, /targets: \[pushgateway:9091\]/)
  assert.match(alerts, /AiCanvasBackupMissing/)
  assert.match(alerts, /93600/)
  assert.match(template, /BACKUP_ENCRYPTION_KEY=replace-with-/)
  assert.match(template, /RESTORE_RESET_CONFIRMED=true/)
  assert.doesNotMatch(template, /BACKUP_ENCRYPTION_KEY=[A-Za-z0-9+/]{43}=/)
})

test('migration release metadata is enforced by the one-shot migration command', () => {
  assert.match(releaseManifest, /"releaseOrder": \["expand", "migrate", "contract"\]/)
  assert.match(releaseManifest, /"version":"0020"/)
  assert.match(applyMigrations, /SET LOCAL lock_timeout/)
  assert.match(applyMigrations, /SET LOCAL statement_timeout/)
  assert.match(applyMigrations, /validateSchemaReleaseManifest/)
})
