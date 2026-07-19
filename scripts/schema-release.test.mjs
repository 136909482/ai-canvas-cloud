import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '@ai-canvas-cloud/server'
import { loadSchemaReleaseManifest, validateSchemaReleaseManifest } from './check-schema-release.mjs'

test('schema release manifest covers every migration with monotonic release phases', () => {
  const result = validateSchemaReleaseManifest(loadSchemaReleaseManifest())
  assert.equal(result.files.length, 20)
  assert.equal(result.manifest.migrations.at(-1).version, '0020')
  assert.equal(result.manifest.migrations.some((migration) => migration.phase === 'contract'), false)
  assert.equal(result.manifest.migrations.filter((migration) => migration.backupRequired).length > 0, true)
})

loadDotEnv()

test('migration interruption rollback and rerun leave a known schema version', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schema = `schema_release_${randomUUID().replaceAll('-', '')}`
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  const migrationFiles = (await readdir(join(process.cwd(), 'server', 'db', 'migrations'))).filter((name) => name.endsWith('.sql')).sort()
  try {
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    for (const fileName of migrationFiles.slice(0, -1)) {
      await client.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
      const [, version, name] = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(fileName)
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, name])
    }
    const newAppOnOldSchema = await client.query(`
      SELECT COALESCE((to_jsonb(migration_exports)->>'retry_count')::integer, 0) AS retry_count
      FROM migration_exports
    `)
    assert.equal(newAppOnOldSchema.fields[0]?.name, 'retry_count')
    const oldAppOnNewSchemaShape = await client.query('SELECT id, status, completed_file_count FROM migration_exports')
    assert.deepEqual(oldAppOnNewSchemaShape.fields.map((field) => field.name), ['id', 'status', 'completed_file_count'])
    const finalSql = await readFile(join(process.cwd(), 'server', 'db', 'migrations', migrationFiles.at(-1)), 'utf8')
    await client.query('BEGIN')
    await client.query(finalSql)
    await client.query('ROLLBACK')
    await client.query('BEGIN')
    await client.query(finalSql)
    await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', ['0020', 'migration_lifecycle_retry'])
    await client.query('COMMIT')
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version')
    assert.equal(applied.rowCount, 20)
    assert.equal(applied.rows.at(-1)?.version, '0020')
    const retryColumn = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'migration_exports' AND column_name = 'retry_count'`, [schema])
    assert.equal(retryColumn.rowCount, 1)
  } finally {
    if (client.readyForQuery) {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.query('SET search_path TO public').catch(() => undefined)
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    }
    await client.end()
  }
})
