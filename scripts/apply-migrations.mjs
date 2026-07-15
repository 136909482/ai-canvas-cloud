import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const migrationsDir = join(process.cwd(), 'server', 'db', 'migrations')
const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/

function readDotEnv() {
  const envPath = join(process.cwd(), '.env')

  if (!existsSync(envPath)) {
    return
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()

    process.env[key] ??= value.replace(/^"(.*)"$/, '$1')
  }
}

function loadMigrations() {
  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName) => {
      const match = migrationPattern.exec(fileName)

      if (!match) {
        throw new Error(`Invalid migration filename: ${fileName}`)
      }

      const sql = readFileSync(join(migrationsDir, fileName), 'utf8').trim()

      if (!sql) {
        throw new Error(`Empty migration: ${fileName}`)
      }

      if (/\bDROP\s+DATABASE\b/i.test(sql)) {
        throw new Error(`Unsafe migration statement in ${fileName}`)
      }

      return {
        fileName,
        version: match[1],
        name: match[2],
        sql,
      }
    })
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function isApplied(client, version) {
  const result = await client.query(
    'SELECT 1 FROM schema_migrations WHERE version = $1',
    [version],
  )

  return result.rowCount > 0
}

async function applyMigration(client, migration) {
  await client.query('BEGIN')

  try {
    if (await isApplied(client, migration.version)) {
      await client.query('COMMIT')
      console.log(`Skipped ${migration.fileName}`)
      return 'skipped'
    }

    await client.query(migration.sql)
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name],
    )
    await client.query('COMMIT')
    console.log(`Applied ${migration.fileName}`)
    return 'applied'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

readDotEnv()

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Missing DATABASE_URL. Copy .env.example to .env or export DATABASE_URL.')
  process.exit(1)
}

const migrations = loadMigrations()

if (migrations.length === 0) {
  console.error('No database migrations found.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })

try {
  await client.connect()
  await ensureMigrationTable(client)

  let appliedCount = 0
  let skippedCount = 0

  for (const migration of migrations) {
    const result = await applyMigration(client, migration)

    if (result === 'applied') {
      appliedCount += 1
    } else {
      skippedCount += 1
    }
  }

  console.log(`Database migrations complete. Applied ${appliedCount}, skipped ${skippedCount}.`)
} finally {
  await client.end()
}
