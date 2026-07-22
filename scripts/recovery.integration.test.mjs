import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '@ai-canvas-cloud/server'
import { auditDatabaseConsistency } from './audit-restored-state.mjs'
import { createRecoveryFingerprint } from './recovery-common.mjs'

loadDotEnv()

test('recovery audit SQL is read-only and valid against the configured PostgreSQL schema', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not configured',
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  const schema = `recovery_audit_${randomUUID().replaceAll('-', '')}`
  try {
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    const migrations = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((name) => name.endsWith('.sql') && !/^(?:002[5-9]|0030)_/.test(name))
      .sort()
    for (const migration of migrations) {
      await client.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', migration), 'utf8'))
      const [, version, name] = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(migration)
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, name])
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const failures = await auditDatabaseConsistency(client, 24, 0)
    const fingerprint = await createRecoveryFingerprint(client)
    await client.query('ROLLBACK')
    assert.deepEqual(failures, [])
    assert.match(fingerprint.digest, /^[0-9a-f]{64}$/)
    assert.equal(typeof fingerprint.counts.projects, 'number')
  } finally {
    if (client.readyForQuery) {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.query('SET search_path TO public').catch(() => undefined)
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    }
    await client.end()
  }
})
