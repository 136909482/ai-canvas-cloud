import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'server', 'db', 'migrations')
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/

const files = readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.error('No database migrations found.')
  process.exit(1)
}

const seenVersions = new Set()

for (const fileName of files) {
  const match = migrationPattern.exec(fileName)

  if (!match) {
    console.error(`Invalid migration filename: ${fileName}`)
    process.exit(1)
  }

  const version = match[1]
  if (seenVersions.has(version)) {
    console.error(`Duplicate migration version: ${version}`)
    process.exit(1)
  }
  seenVersions.add(version)

  const sql = readFileSync(join(migrationsDir, fileName), 'utf8').trim()
  if (!sql) {
    console.error(`Empty migration: ${fileName}`)
    process.exit(1)
  }

  if (/\bDROP\s+DATABASE\b/i.test(sql)) {
    console.error(`Unsafe migration statement in ${fileName}`)
    process.exit(1)
  }
}

console.log(`Checked ${files.length} database migration file(s).`)
