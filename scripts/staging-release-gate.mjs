import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateProtectedDeploymentEnvironment } from '../packages/shared/dist/index.js'

const WEB_FORBIDDEN = [
  /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i,
  /(?:__vite_(?:client|hmr)|\/@vite|vite\/client|import\.meta\.hot|webpack-dev-server)/i,
  /(?:BETTER_AUTH_SECRET|S3_SECRET_ACCESS_KEY|PROVIDER_CREDENTIAL_KEYS|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY)/i,
  /(?:[A-Z]:\\|\/app\/|node_modules\/)/i,
]

function readEnvFile(file) {
  const env = { ...process.env }
  if (!existsSync(file)) throw new Error(`Environment file not found: ${file}`)
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1')
    env[key] ??= value
  }
  return env
}

export function scanWebBundle(directory) {
  if (!existsSync(directory)) throw new Error('Web production bundle is missing; run the production build first')
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (/\.(?:html|js|css|json|map)$/i.test(entry.name)) files.push(full)
    }
  }
  visit(directory)
  if (!files.some((file) => file.endsWith('index.html'))) throw new Error('Web production bundle has no index.html')
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const pattern of WEB_FORBIDDEN) {
      if (pattern.test(content)) throw new Error(`Web bundle contains a forbidden development or secret marker (${pattern.source})`)
    }
  }
  return { files: files.length }
}

export function validateReleaseArtifacts(root = process.cwd()) {
  const required = [
    'Dockerfile',
    '.dockerignore',
    'infra/deploy/staging/docker-compose.yml',
    'infra/deploy/staging/web.nginx.conf',
    'infra/deploy/staging/prometheus.yml',
    'infra/deploy/staging/alerts.yml',
    'server/db/migrations/release-manifest.json',
    'apps/api/dist/index.js',
    'apps/worker/dist/index.js',
    'server/dist/index.js',
  ]
  for (const file of required) if (!existsSync(resolve(root, file))) throw new Error(`Release artifact is missing: ${file}`)
  const compose = readFileSync(resolve(root, 'infra/deploy/staging/docker-compose.yml'), 'utf8')
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
  const nginx = readFileSync(resolve(root, 'infra/deploy/staging/web.nginx.conf'), 'utf8')
  const alerts = readFileSync(resolve(root, 'infra/deploy/staging/alerts.yml'), 'utf8')
  if (!/profiles:\s*\["release"\]/.test(compose) || /apply-migrations\.mjs.*(?:api|worker)/.test(compose)) throw new Error('Migrations must be an explicit release-only step')
  if (!/AS api[\s\S]*USER node/.test(dockerfile) || !/AS worker[\s\S]*USER node/.test(dockerfile) || !/AS web/.test(dockerfile)) throw new Error('API, Worker and Web runtime artifacts must run as non-root images')
  if (!/Content-Security-Policy/.test(nginx) || !/frame-ancestors 'none'/.test(nginx) || /unsafe-eval/.test(nginx)) throw new Error('Web security headers are incomplete')
  if (!/AiCanvasDependencyDown/.test(alerts) || !/AiCanvasBackupMissing/.test(alerts)) throw new Error('Dependency and backup alerts are required')
  return { requiredArtifacts: required.length }
}

export function validateCleanupAudit(report) {
  if (!report || typeof report !== 'object') throw new Error('Cleanup audit report must be an object')
  const fields = ['orphanFormalAssets', 'permanentRunningTasks', 'duplicateCharges', 'unreclaimableStagingObjects']
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(report, field)) throw new Error(`Cleanup audit field ${field} is required`)
    const value = Number(report[field])
    if (!Number.isInteger(value) || value < 0) throw new Error(`Cleanup audit field ${field} must be a non-negative integer`)
    if (value !== 0) throw new Error(`Cleanup audit failed: ${field}`)
  }
  return true
}

async function probe(url, path, expectedStatus = 200) {
  const target = new URL(path, url)
  const response = await fetch(target, { redirect: 'manual' })
  if (response.status !== expectedStatus) throw new Error(`Endpoint probe failed (${path}, status ${response.status})`)
  return response.status
}

export async function runGate({ root = process.cwd(), envFile, webUrl, apiUrl, workerUrl, auditFile } = {}) {
  const env = readEnvFile(resolve(root, envFile ?? 'infra/deploy/staging/staging.env'))
  validateProtectedDeploymentEnvironment(env)
  const artifacts = validateReleaseArtifacts(root)
  const web = scanWebBundle(resolve(root, 'apps/web/dist'))
  if (auditFile) validateCleanupAudit(JSON.parse(readFileSync(resolve(root, auditFile), 'utf8')))
  const probes = []
  if (webUrl) probes.push(await probe(webUrl, '/'))
  if (apiUrl) probes.push(await probe(apiUrl, '/health/live'))
  if (apiUrl) probes.push(await probe(apiUrl, '/health/ready'))
  if (workerUrl) probes.push(await probe(workerUrl, '/health/ready'))
  return { artifacts, web, probes }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    const key = argv[index].slice(2)
    args[key] = argv[index + 1]?.startsWith('--') ? true : (argv[index + 1] ?? true)
    if (args[key] !== true) index += 1
  }
  return args
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2))
  runGate({
    root: process.cwd(),
    envFile: args['env-file'],
    webUrl: args['web-url'],
    apiUrl: args['api-url'],
    workerUrl: args['worker-url'],
    auditFile: args['audit-file'],
  }).then((result) => {
    console.log(JSON.stringify({ event: 'staging_release_gate_passed', artifactCount: result.artifacts.requiredArtifacts, webFiles: result.web.files, probes: result.probes.length }))
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'staging_release_gate_failed', error: error instanceof Error ? error.message : 'UnknownError' }))
    process.exitCode = 1
  })
}
