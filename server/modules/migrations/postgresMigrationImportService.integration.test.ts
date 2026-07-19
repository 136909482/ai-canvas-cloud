import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import {
  canonicalJsonStringify,
  createMigrationPackageContentDigestInput,
  type MigrationJsonValue,
} from '@ai-canvas-cloud/contracts'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresMigrationImportService } from '../../dist/modules/migrations/postgresMigrationImportService.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const ASSET_ID = '33333333-3333-4333-8333-333333333333'
const ASSET_HASH = 'b'.repeat(64)

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonical(value: unknown) {
  return canonicalJsonStringify(value as MigrationJsonValue)
}

function prepareRequest(idempotencyKey: string, projectName = 'Imported project') {
  const snapshot = {
    schemaVersion: 1 as const,
    canvas: {
      nodes: [{
        id: 'node-1',
        type: 'imageNode',
        position: { x: 0, y: 0 },
        data: {
          imageAsset: {
            assetId: ASSET_ID,
            relativePath: `assets/${ASSET_ID}.png`,
            mimeType: 'image/png',
            fileName: 'source.png',
          },
        },
      }],
      edges: [],
    },
    taskQueue: { tasks: [] },
  }
  const projectRecord = {
    id: PROJECT_A,
    name: projectName,
    savedSnapshot: snapshot,
    workingSnapshot: snapshot,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    lastOpenedAt: '2026-07-18T00:00:00.000Z',
    archivedAt: null,
  }
  const graph = {
    schemaVersion: 1 as const,
    projectId: PROJECT_A,
    version: 2,
    sequence: 3,
    nodes: [{
      id: 'node-1',
      nodeType: 'imageNode',
      position: { x: 0, y: 0 },
      dataSchemaVersion: 1,
      data: { assetId: ASSET_ID },
    }],
    edges: [],
  }
  const assetManifest = {
    schemaVersion: 1 as const,
    assets: [{
      logicalAssetId: ASSET_ID,
      filePath: `assets/${ASSET_ID}.png`,
      originalFileName: 'source.png',
      mimeType: 'image/png',
      byteSize: 20,
      sha256: ASSET_HASH,
      width: 16,
      height: 16,
      assetKind: 'upload' as const,
    }],
  }
  const jsonFiles = [
    { path: 'assets.json', content: canonical(assetManifest) },
    { path: 'graph.json', content: canonical(graph) },
    { path: 'project.json', content: canonical(projectRecord) },
  ]
  const files = [
    { path: 'assets.json', byteSize: Buffer.byteLength(jsonFiles[0]!.content), sha256: hash(jsonFiles[0]!.content) },
    { path: `assets/${ASSET_ID}.png`, byteSize: 20, sha256: ASSET_HASH },
    { path: 'graph.json', byteSize: Buffer.byteLength(jsonFiles[1]!.content), sha256: hash(jsonFiles[1]!.content) },
    { path: 'project.json', byteSize: Buffer.byteLength(jsonFiles[2]!.content), sha256: hash(jsonFiles[2]!.content) },
  ]
  const totalByteSize = files.reduce((total, file) => total + file.byteSize, 0)
  return {
    idempotencyKey,
    manifest: {
      packageSchemaVersion: 1 as const,
      packageId: 'package-1',
      sourcePlatform: 'electron' as const,
      exportedAt: '2026-07-18T00:00:00.000Z',
      project: { id: PROJECT_A, version: 2, sequence: 3 },
      fileCount: files.length,
      totalByteSize,
      contentSha256: hash(createMigrationPackageContentDigestInput(files)),
      files,
    },
    projectRecord,
    graph,
    assetManifest,
    checkpoint: null,
    archiveEntries: [
      { path: 'assets.json', kind: 'file' as const, uncompressedSize: files[0]!.byteSize, compressedSize: files[0]!.byteSize, sha256: files[0]!.sha256 },
      { path: `assets/${ASSET_ID}.png`, kind: 'file' as const, uncompressedSize: 20, compressedSize: 20, sha256: ASSET_HASH },
      { path: 'graph.json', kind: 'file' as const, uncompressedSize: files[2]!.byteSize, compressedSize: files[2]!.byteSize, sha256: files[2]!.sha256 },
      { path: 'manifest.json', kind: 'file' as const, uncompressedSize: 1, compressedSize: 1 },
      { path: 'project.json', kind: 'file' as const, uncompressedSize: files[3]!.byteSize, compressedSize: files[3]!.byteSize, sha256: files[3]!.sha256 },
    ],
  }
}

test('PostgreSQL migration prepare is durable, idempotent, quota-safe, and workspace isolated', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `migration_import_service_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  let pool: pg.Pool | undefined
  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 30_000,
      max: 4,
      options: `-c search_path=${schemaName},public`,
    })
    const migrations = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort()
    for (const fileName of migrations) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }
    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('migration-owner-a', 'A', 'migration-a@example.com', true),
             ('migration-owner-b', 'B', 'migration-b@example.com', true),
             ('migration-viewer', 'Viewer', 'migration-viewer@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id, storage_quota_bytes)
      VALUES ($1, 'Migrations A', 'migration-owner-a', 100),
             ($2, 'Migrations B', 'migration-owner-b', 100)
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'migration-owner-a', 'owner'),
             ($2, 'migration-owner-b', 'owner'),
             ($1, 'migration-viewer', 'viewer')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO projects (id, workspace_id, name, version, last_sequence)
      VALUES ($1, $2, 'Existing project', 2, 3)
    `, [PROJECT_A, WORKSPACE_A])

    let service = createPostgresMigrationImportService(pool)
    const actorA = { userId: 'migration-owner-a', workspaceId: WORKSPACE_A }
    const actorB = { userId: 'migration-owner-b', workspaceId: WORKSPACE_B }
    const viewer = { userId: 'migration-viewer', workspaceId: WORKSPACE_A }
    const prepared = await service.prepareImport(prepareRequest('prepare-one'), actorA)
    assert.equal(prepared.import.status, 'prepared')
    assert.equal(prepared.import.conflict.type, 'project_exists')
    assert.deepEqual(prepared.import.allowedStrategies, ['copy', 'replace'])
    assert.equal(prepared.import.conflict.targetProject?.expectedVersion, 2)
    assert.equal(prepared.import.estimates.estimatedStorageBytes, 20)
    assert.equal(prepared.import.estimates.availableBytesAtPrepare, 100)
    assert.equal(prepared.import.uploads[0]?.logicalAssetId, ASSET_ID)
    assert.equal('workspaceId' in prepared.import, false)
    assert.equal('objectKey' in prepared.import.uploads[0]!, false)

    const replay = await service.prepareImport(prepareRequest('prepare-one'), actorA)
    assert.equal(replay.import.id, prepared.import.id)
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM migration_imports WHERE workspace_id = $1`, [WORKSPACE_A])).rows[0]?.count, 1)
    await assert.rejects(
      () => service.prepareImport(prepareRequest('prepare-one', 'Different valid package'), actorA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'IMPORT_CONFLICT',
    )
    const badDigest = prepareRequest('bad-digest')
    badDigest.manifest.contentSha256 = 'a'.repeat(64)
    await assert.rejects(
      () => service.prepareImport(badDigest, actorA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'IMPORT_INVALID',
    )
    await assert.rejects(
      () => service.prepareImport(prepareRequest('viewer-prepare'), viewer),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'ACCESS_DENIED',
    )

    service = createPostgresMigrationImportService(pool)
    assert.equal((await service.getImport(prepared.import.id, actorA)).import.id, prepared.import.id)
    const viewerState = await service.getImport(prepared.import.id, viewer)
    assert.deepEqual(viewerState.import.allowedStrategies, [])
    await assert.rejects(
      () => service.getImport(prepared.import.id, actorB),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'RESOURCE_NOT_FOUND',
    )
    const crossWorkspace = await service.prepareImport(prepareRequest('cross-workspace-id'), actorB)
    assert.equal(crossWorkspace.import.conflict.type, 'project_id_unavailable')
    assert.equal(crossWorkspace.import.conflict.targetProject, null)
    assert.deepEqual(crossWorkspace.import.allowedStrategies, ['copy'])

    await pool.query(`UPDATE workspaces SET storage_quota_bytes = 10 WHERE id = $1`, [WORKSPACE_B])
    await assert.rejects(
      () => service.prepareImport(prepareRequest('quota-over'), actorB),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'QUOTA_EXCEEDED',
    )
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM migration_imports WHERE idempotency_key = 'quota-over'`)).rows[0]?.count, 0)

    const canceled = await service.cancelImport(prepared.import.id, actorA)
    assert.equal(canceled.import.status, 'canceled')
    assert.equal((await service.cancelImport(prepared.import.id, actorA)).import.status, 'canceled')
    const expiring = await service.prepareImport(prepareRequest('prepare-expired'), actorA)
    await pool.query(`
      UPDATE migration_imports
      SET created_at = now() - interval '2 seconds', expires_at = now() - interval '1 second'
      WHERE id = $1
    `, [expiring.import.id])
    assert.equal((await service.getImport(expiring.import.id, actorA)).import.status, 'expired')

    const projectState = await pool.query(`SELECT version, last_sequence FROM projects WHERE id = $1`, [PROJECT_A])
    assert.equal(Number(projectState.rows[0]?.version), 2)
    assert.equal(Number(projectState.rows[0]?.last_sequence), 3)
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM assets`)).rows[0]?.count, 0)
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM asset_references`)).rows[0]?.count, 0)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
