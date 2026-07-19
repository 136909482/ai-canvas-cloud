import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const migrationsDirectory = join(process.cwd(), 'server', 'db', 'migrations')
const manifestPath = join(migrationsDirectory, 'release-manifest.json')
const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/
const phases = new Map([['expand', 0], ['migrate', 1], ['contract', 2]])

export function loadSchemaReleaseManifest() {
  if (!existsSync(manifestPath)) throw new Error('Missing server/db/migrations/release-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.manifestVersion !== 1 || JSON.stringify(manifest.releaseOrder) !== JSON.stringify(['expand', 'migrate', 'contract'])) {
    throw new Error('Schema release manifest version or releaseOrder is invalid')
  }
  return manifest
}

export function validateSchemaReleaseManifest(manifest = loadSchemaReleaseManifest()) {
  const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()
  if (files.length !== manifest.migrations.length) throw new Error('Schema release manifest does not cover every SQL migration')
  let previousPhase = 0
  const seen = new Set()
  for (const [index, migration] of manifest.migrations.entries()) {
    const fileName = files[index]
    const match = migrationPattern.exec(fileName)
    if (!match || migration.version !== match[1] || migration.name !== match[2]) {
      throw new Error(`Schema release metadata does not match ${fileName}`)
    }
    if (seen.has(migration.version) || phases.get(migration.phase) === undefined) throw new Error(`Invalid schema release entry ${migration.version}`)
    seen.add(migration.version)
    const phase = phases.get(migration.phase)
    if (phase < previousPhase) throw new Error(`Schema release phase moved backwards at ${migration.version}`)
    previousPhase = phase
    if (![true, false].includes(migration.oldAppReadable)
      || ![true, false].includes(migration.newAppReadable)
      || ![true, false].includes(migration.oldAppWithNewSchema)
      || !['low', 'medium', 'high'].includes(migration.lockRisk)
      || !Number.isInteger(migration.statementTimeoutMs) || migration.statementTimeoutMs < 1000 || migration.statementTimeoutMs > 300000
      || typeof migration.rollback !== 'string' || migration.rollback.length < 10
      || typeof migration.forwardRepair !== 'string' || migration.forwardRepair.length < 10
      || typeof migration.backupRequired !== 'boolean') {
      throw new Error(`Incomplete schema release metadata for ${migration.version}`)
    }
    const sql = readFileSync(join(migrationsDirectory, fileName), 'utf8')
    if (/\bDROP\s+(?:TABLE|COLUMN|DATABASE)\b/i.test(sql) && migration.backupRequired !== true) {
      throw new Error(`Destructive migration ${migration.version} must require a backup`)
    }
  }
  return { manifest, files }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = validateSchemaReleaseManifest()
    console.log(JSON.stringify({ event: 'schema_release_manifest_valid', migrations: result.files.length }))
  } catch (error) {
    console.error(JSON.stringify({ event: 'schema_release_manifest_invalid', error: error instanceof Error ? error.name : 'UnknownError' }))
    process.exitCode = 1
  }
}
