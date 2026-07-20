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
const WORKSPACE_A_SECOND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('PostgreSQL provider credentials are encrypted, user-scoped, and available across the user workspaces', {
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
      INSERT INTO workspaces (id, type, name, owner_user_id)
      VALUES ($1, 'personal', 'Provider A', 'provider-owner-a'),
             ($2, 'team', 'Provider A Second', 'provider-owner-a'),
             ($3, 'personal', 'Provider B', 'provider-owner-b')
    `, [WORKSPACE_A, WORKSPACE_A_SECOND, WORKSPACE_B])
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'provider-owner-a', 'owner'), ($1, 'provider-viewer-a', 'viewer'),
             ($2, 'provider-owner-a', 'owner'), ($3, 'provider-owner-b', 'owner')
    `, [WORKSPACE_A, WORKSPACE_A_SECOND, WORKSPACE_B])

    const cipher = createProviderCredentialCipher(parseProviderCredentialKeyring(
      `1:${Buffer.alloc(32, 7).toString('base64')}`,
      1,
    ))
    const service = createPostgresProviderCredentialService(pool, { cipher })
    const ownerA = { userId: 'provider-owner-a', workspaceId: WORKSPACE_A }
    const ownerASecond = { userId: 'provider-owner-a', workspaceId: WORKSPACE_A_SECOND }
    const viewerA = { userId: 'provider-viewer-a', workspaceId: WORKSPACE_A }
    const ownerB = { userId: 'provider-owner-b', workspaceId: WORKSPACE_B }
    const apiKey = 'postgres-provider-secret-1234'

    const initial = await service.listProviders(ownerA)
    assert.equal(initial.providers.length, 0)
    await service.putProvider('openai', { apiKey: 'viewer-private-secret-4567' }, viewerA)
    assert.equal((await service.listProviders(viewerA)).providers.length, 1)
    assert.equal((await service.listProviders(ownerA)).providers.length, 0)
    await assert.rejects(
      () => service.putProvider('openai', { apiKey, baseUrl: 'https://127.0.0.1' }, ownerA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )

    const saved = await service.putProvider('openai', { apiKey }, ownerA)
    assert.equal(saved.provider.secretLastFour, '1234')
    assert.equal(saved.provider.websiteUrl, 'https://openai.com')
    assert.equal('apiKey' in saved.provider, false)
    const raw = await pool.query<{
      workspace_id: string | null
      encrypted_secret_json: unknown
      key_version: number
      secret_last_four: string
    }>(`
      SELECT workspace_id::text, encrypted_secret_json, key_version, secret_last_four
      FROM provider_credentials WHERE user_id = $1 AND provider_id = 'openai'
    `, [ownerA.userId])
    assert.equal(raw.rowCount, 1)
    assert.equal(JSON.stringify(raw.rows[0]?.encrypted_secret_json).includes(apiKey), false)
    assert.equal(raw.rows[0]?.key_version, 1)
    assert.equal(raw.rows[0]?.secret_last_four, '1234')
    assert.equal(raw.rows[0]?.workspace_id, null)

    const execution = await service.getExecutionCredential({ userId: ownerA.userId, providerId: 'openai' })
    assert.equal(execution.apiKey, apiKey)
    assert.equal(execution.baseUrl, 'https://api.openai.com')
    const custom = await service.putProvider('krill', {
      label: 'Krill',
      websiteUrl: 'https://krill.ai',
      baseUrl: 'https://api.cdn-krill-ai.com/v1',
      apiKey: 'custom-provider-secret-9012',
    }, ownerA)
    assert.equal(custom.provider.label, 'Krill')
    assert.equal(custom.provider.websiteUrl, 'https://krill.ai')
    await service.putProvider('krill', {
      label: 'Krill AI',
      websiteUrl: 'https://www.krill.ai',
      baseUrl: 'https://api.cdn-krill-ai.com/v1',
    }, ownerA)
    assert.equal(
      (await service.listProviders(ownerA)).providers.find((provider) => provider.providerId === 'krill')?.websiteUrl,
      'https://www.krill.ai',
    )
    await assert.rejects(
      () => service.putProvider('krill', { websiteUrl: 'http://127.0.0.1' }, ownerA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )
    const customExecution = await service.getExecutionCredential({ userId: ownerA.userId, providerId: 'krill' })
    assert.equal(customExecution.providerType, 'openai_compatible')
    assert.equal(customExecution.apiKey, 'custom-provider-secret-9012')
    await assert.rejects(
      () => service.getExecutionCredential({ userId: ownerB.userId, providerId: 'openai' }),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'PROVIDER_CONFIG_INVALID',
    )
    assert.equal((await service.listProviders(ownerB)).providers.length, 0)
    assert.deepEqual(
      (await service.listProviders(ownerASecond)).providers.map((provider) => provider.providerId),
      ['krill', 'openai'],
    )
    assert.equal(
      (await service.getExecutionCredential({ userId: viewerA.userId, providerId: 'openai' })).apiKey,
      'viewer-private-secret-4567',
    )

    await service.putProvider('openai', { apiKey: 'rotated-provider-secret-5678' }, ownerA)
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM provider_credentials WHERE user_id = $1`,
      [ownerA.userId],
    )).rows[0]?.count, 2)
    await service.deleteProvider('openai', ownerB)
    assert.equal((await service.listProviders(ownerA)).providers.find(
      (provider) => provider.providerId === 'openai',
    )?.configured, true)

    const legacyEnvelope = cipher.encrypt('legacy-provider-secret-2468', {
      scope: 'workspace',
      scopeId: WORKSPACE_B,
      providerId: 'legacy',
    })
    await pool.query(`
      INSERT INTO provider_credentials (
        workspace_id, user_id, provider_id, display_name, provider_type, base_url,
        encrypted_secret_json, key_version, secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES ($1, $2, 'legacy', 'Legacy', 'openai_compatible', 'https://legacy.example.com/v1',
        $3::jsonb, $4, '2468', $2, $2)
    `, [WORKSPACE_B, ownerB.userId, JSON.stringify(legacyEnvelope), legacyEnvelope.keyVersion])
    assert.equal(
      (await service.getExecutionCredential({ userId: ownerB.userId, providerId: 'legacy' })).apiKey,
      'legacy-provider-secret-2468',
    )
    await service.putProvider('legacy', { apiKey: 'rotated-legacy-secret-8642' }, ownerB)
    assert.equal((await pool.query(
      `SELECT workspace_id FROM provider_credentials WHERE user_id = $1 AND provider_id = 'legacy'`,
      [ownerB.userId],
    )).rows[0]?.workspace_id, null)

    await service.deleteProvider('openai', ownerA)
    assert.deepEqual((await service.listProviders(ownerA)).providers.map((provider) => provider.providerId), ['krill'])
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
