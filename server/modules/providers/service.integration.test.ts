import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import {
  createProviderCredentialCipher,
  parseProviderCredentialKeyring,
} from '../../dist/modules/providers/credentialCipher.js'
import { createPostgresProviderCredentialService } from '../../dist/modules/providers/service.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('PostgreSQL provider credentials are encrypted, role-checked, and workspace isolated', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `provider_credentials_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  let pool: pg.Pool | undefined

  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 3,
      options: `-c search_path=${schemaName},public`,
    })
    const migrationFiles = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort()
    for (const fileName of migrationFiles) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('provider-owner-a', 'A', 'provider-a@example.com', true),
             ('provider-viewer-a', 'A Viewer', 'provider-viewer-a@example.com', true),
             ('provider-owner-b', 'B', 'provider-b@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, 'Provider A', 'provider-owner-a'), ($2, 'Provider B', 'provider-owner-b')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'provider-owner-a', 'owner'), ($1, 'provider-viewer-a', 'viewer'),
             ($2, 'provider-owner-b', 'owner')
    `, [WORKSPACE_A, WORKSPACE_B])

    const cipher = createProviderCredentialCipher(parseProviderCredentialKeyring(
      `1:${Buffer.alloc(32, 7).toString('base64')}`,
      1,
    ))
    const service = createPostgresProviderCredentialService(pool, { cipher })
    const ownerA = { userId: 'provider-owner-a', workspaceId: WORKSPACE_A }
    const viewerA = { userId: 'provider-viewer-a', workspaceId: WORKSPACE_A }
    const ownerB = { userId: 'provider-owner-b', workspaceId: WORKSPACE_B }
    const apiKey = 'postgres-provider-secret-1234'

    const initial = await service.listProviders(ownerA)
    assert(initial.providers.every((provider) => !provider.configured))
    await assert.rejects(
      () => service.putProvider('openai', { apiKey }, viewerA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'ACCESS_DENIED',
    )
    await assert.rejects(
      () => service.putProvider('openai', { apiKey, baseUrl: 'https://127.0.0.1' }, ownerA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )

    const saved = await service.putProvider('openai', { apiKey }, ownerA)
    assert.equal(saved.provider.secretLastFour, '1234')
    assert.equal('apiKey' in saved.provider, false)
    const raw = await pool.query<{
      encrypted_secret_json: unknown
      key_version: number
      secret_last_four: string
    }>(`
      SELECT encrypted_secret_json, key_version, secret_last_four
      FROM provider_credentials WHERE workspace_id = $1 AND provider_id = 'openai'
    `, [WORKSPACE_A])
    assert.equal(raw.rowCount, 1)
    assert.equal(JSON.stringify(raw.rows[0]?.encrypted_secret_json).includes(apiKey), false)
    assert.equal(raw.rows[0]?.key_version, 1)
    assert.equal(raw.rows[0]?.secret_last_four, '1234')

    const execution = await service.getExecutionCredential({ workspaceId: WORKSPACE_A, providerId: 'openai' })
    assert.equal(execution.apiKey, apiKey)
    assert.equal(execution.baseUrl, 'https://api.openai.com')
    await assert.rejects(
      () => service.getExecutionCredential({ workspaceId: WORKSPACE_B, providerId: 'openai' }),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'PROVIDER_CONFIG_INVALID',
    )
    assert((await service.listProviders(ownerB)).providers.every((provider) => !provider.configured))

    await service.putProvider('openai', { apiKey: 'rotated-provider-secret-5678' }, ownerA)
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM provider_credentials WHERE workspace_id = $1`,
      [WORKSPACE_A],
    )).rows[0]?.count, 1)
    await service.deleteProvider('openai', ownerB)
    assert.equal((await service.listProviders(ownerA)).providers.find(
      (provider) => provider.providerId === 'openai',
    )?.configured, true)
    await service.deleteProvider('openai', ownerA)
    assert.equal((await service.listProviders(ownerA)).providers.find(
      (provider) => provider.providerId === 'openai',
    )?.configured, false)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
