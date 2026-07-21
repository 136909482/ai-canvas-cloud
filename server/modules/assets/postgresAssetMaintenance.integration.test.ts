import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import type { AssetMaintenanceObjectStorage } from '../../dist/modules/assets/assetMaintenance.js'
import { createPostgresAssetMaintenanceService } from '../../dist/modules/assets/postgresAssetMaintenance.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'
const CURRENT_ASSET = '33333333-3333-4333-8333-333333333333'
const CHECKPOINT_ASSET = '44444444-4444-4444-8444-444444444444'
const ORPHAN_ASSET = '55555555-5555-4555-8555-555555555555'
const MISSING_ASSET = '66666666-6666-4666-8666-666666666666'
const FAILURE_ASSET = '77777777-7777-4777-8777-777777777777'
const BUCKET_ORPHAN_ASSET = '88888888-8888-4888-8888-888888888888'
const RECENT_BUCKET_ORPHAN_ASSET = '99999999-9999-4999-8999-999999999999'

function key(workspaceId: string, projectId: string, assetId: string) {
  return `workspaces/${workspaceId}/projects/${projectId}/uploads/${assetId}.png`
}

test('PostgreSQL asset maintenance protects references, diagnoses missing objects, and converges idempotently', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `asset_maintenance_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  let pool: pg.Pool | undefined

  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schemaName},public`,
    })
    const migrationFiles = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((fileName) => fileName.endsWith('.sql') && !fileName.startsWith('0025_'))
      .sort()
    for (const fileName of migrationFiles) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('maintenance-user-a', 'A', 'maintenance-a@example.com', true),
             ('maintenance-user-b', 'B', 'maintenance-b@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, 'Maintenance A', 'maintenance-user-a'), ($2, 'Maintenance B', 'maintenance-user-b')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO projects (id, workspace_id, name, version, last_sequence, node_count)
      VALUES ($1, $2, 'Project A', 5, 9, 1), ($3, $4, 'Project B', 0, 0, 0)
    `, [PROJECT_A, WORKSPACE_A, PROJECT_B, WORKSPACE_B])
    await pool.query(`
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
      VALUES ($1, 'current-node', 'image', 0, 0)
    `, [PROJECT_A])
    await pool.query(`
      INSERT INTO project_changes (
        project_id, sequence, base_version, result_version, actor_user_id,
        batch_id, idempotency_key, source, operations_json
      ) VALUES ($1, 9, 4, 5, 'maintenance-user-a', 'maintenance-batch', 'maintenance-key', 'user', '[]')
    `, [PROJECT_A])

    const assetRows = [CURRENT_ASSET, CHECKPOINT_ASSET, ORPHAN_ASSET, MISSING_ASSET, FAILURE_ASSET]
    for (const assetId of assetRows) {
      await pool.query(`
        INSERT INTO assets (
          id, workspace_id, origin_project_id, created_by_user_id, object_key,
          original_file_name, mime_type, byte_size, asset_kind, status, created_at, updated_at
        ) VALUES ($1, $2, $3, 'maintenance-user-a', $4, 'asset.png', 'image/png', 4, 'upload', 'completed', now() - interval '30 days', now() - interval '30 days')
      `, [assetId, WORKSPACE_A, PROJECT_A, key(WORKSPACE_A, PROJECT_A, assetId)])
    }
    await pool.query(
      `UPDATE assets SET status = 'failed' WHERE id IN ($1, $2)`,
      [ORPHAN_ASSET, FAILURE_ASSET],
    )
    await pool.query(`
      INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
      VALUES ($1, $2, $3, 'current-node', 'source'), ($1, $4, $3, 'current-node', 'preview')
    `, [WORKSPACE_A, CURRENT_ASSET, PROJECT_A, MISSING_ASSET])
    await pool.query(`
      INSERT INTO project_snapshots (
        project_id, project_version, last_sequence, snapshot_type, schema_version,
        record_json, byte_size, asset_manifest_json, is_valid, created_at
      ) VALUES
        ($1, 5, 9, 'manual', 1, '{}'::jsonb, 2, $2::jsonb, true, now() - interval '20 days'),
        ($3, 0, 0, 'manual', 1, '{}'::jsonb, 2, $4::jsonb, true, now() - interval '20 days')
    `, [PROJECT_A, JSON.stringify([CHECKPOINT_ASSET]), PROJECT_B, JSON.stringify([ORPHAN_ASSET])])

    const objects = new Map<string, { lastModified: string; byteSize: number }>()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()
    for (const assetId of [CURRENT_ASSET, CHECKPOINT_ASSET, ORPHAN_ASSET, FAILURE_ASSET]) {
      objects.set(key(WORKSPACE_A, PROJECT_A, assetId), { lastModified: old, byteSize: 4 })
    }
    const bucketOrphanKey = key(WORKSPACE_A, PROJECT_A, BUCKET_ORPHAN_ASSET)
    const recentBucketOrphanKey = key(WORKSPACE_A, PROJECT_A, RECENT_BUCKET_ORPHAN_ASSET)
    const unrecognizedKey = `workspaces/${WORKSPACE_A}/manual-file.txt`
    objects.set(bucketOrphanKey, { lastModified: old, byteSize: 4 })
    objects.set(recentBucketOrphanKey, { lastModified: recent, byteSize: 4 })
    objects.set(unrecognizedKey, { lastModified: old, byteSize: 4 })

    let failDeleteKey: string | null = key(WORKSPACE_A, PROJECT_A, ORPHAN_ASSET)
    const storage: AssetMaintenanceObjectStorage = {
      async createPresignedUpload() { throw new Error('not expected') },
      async createPresignedDownload() { throw new Error('not expected') },
      async getObjectMetadata() { throw new Error('not expected') },
      async calculateObjectSha256() { throw new Error('not expected') },
      async objectExists(objectKey) { return objects.has(objectKey) },
      async listObjectsPage(input) {
        assert.equal(input.prefix, 'workspaces/')
        const all = [...objects.entries()].sort(([left], [right]) => left.localeCompare(right))
        const start = input.startAfter
          ? all.findIndex(([objectKey]) => objectKey > input.startAfter!)
          : 0
        if (start < 0) {
          return { objects: [], nextStartAfter: null }
        }
        const page = all.slice(start, start + input.maxKeys)
        const next = start + page.length < all.length ? page.at(-1)?.[0] ?? null : null
        return {
          objects: page.map(([objectKey, metadata]) => ({ objectKey, ...metadata })),
          nextStartAfter: next,
        }
      },
      async deleteObject(objectKey) {
        if (objectKey === failDeleteKey) {
          throw new Error('simulated object deletion failure')
        }
        objects.delete(objectKey)
      },
    }
    const service = createPostgresAssetMaintenanceService(pool, storage)
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const preflightItems = []
    let cursor = null
    do {
      const batch = await service.maintainAssetBatch({ cutoff, batchSize: 2, cursor })
      preflightItems.push(...batch.items)
      cursor = batch.nextCursor
    } while (cursor)
    assert.equal(preflightItems.find((item) => item.assetId === CURRENT_ASSET)?.reason, 'current_reference')
    assert.equal(preflightItems.find((item) => item.assetId === CHECKPOINT_ASSET)?.reason, 'checkpoint_reference')
    assert.equal(preflightItems.find((item) => item.assetId === ORPHAN_ASSET)?.action, 'would_delete_asset_object')
    assert.equal(preflightItems.find((item) => item.assetId === MISSING_ASSET)?.action, 'missing_object')

    const beforeProject = (await pool.query(
      `SELECT version, last_sequence, node_count FROM projects WHERE id = $1`,
      [PROJECT_A],
    )).rows[0]
    const beforeChanges = (await pool.query(
      `SELECT count(*)::integer AS count FROM project_changes WHERE project_id = $1`,
      [PROJECT_A],
    )).rows[0]?.count

    await assert.rejects(
      () => service.maintainAssetBatch({ cutoff, batchSize: 500, apply: true }),
      /simulated object deletion failure/,
    )
    assert.equal((await pool.query(`SELECT status FROM assets WHERE id = $1`, [ORPHAN_ASSET])).rows[0]?.status, 'failed')
    failDeleteKey = null

    const referenceWriter = await pool.connect()
    let applied
    try {
      await referenceWriter.query('BEGIN')
      await referenceWriter.query(`SELECT id FROM assets WHERE id = $1 FOR SHARE`, [FAILURE_ASSET])
      await referenceWriter.query(`
        INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
        VALUES ($1, $2, $3, 'current-node', 'thumbnail')
      `, [WORKSPACE_A, FAILURE_ASSET, PROJECT_A])
      applied = await service.maintainAssetBatch({ cutoff, batchSize: 500, apply: true })
      assert.equal(applied.items.find((item) => item.assetId === FAILURE_ASSET)?.action, 'skipped_locked')
      await referenceWriter.query('COMMIT')
    } finally {
      await referenceWriter.query('ROLLBACK').catch(() => undefined)
      referenceWriter.release()
    }
    assert.equal(applied.items.find((item) => item.assetId === ORPHAN_ASSET)?.action, 'asset_object_deleted')
    assert.equal(applied.items.find((item) => item.assetId === MISSING_ASSET)?.action, 'missing_object')
    assert.equal((await pool.query(`SELECT status FROM assets WHERE id = $1`, [ORPHAN_ASSET])).rows[0]?.status, 'deleted')
    assert.equal((await pool.query(`SELECT status FROM assets WHERE id = $1`, [CURRENT_ASSET])).rows[0]?.status, 'completed')
    assert.equal((await pool.query(`SELECT status FROM assets WHERE id = $1`, [CHECKPOINT_ASSET])).rows[0]?.status, 'completed')

    const rerun = await service.maintainAssetBatch({ cutoff, batchSize: 500, apply: true })
    assert.equal(rerun.items.find((item) => item.assetId === ORPHAN_ASSET)?.action, 'retained')
    assert.equal(rerun.items.find((item) => item.assetId === FAILURE_ASSET)?.reason, 'current_reference')

    const objectItems = []
    let startAfter = null
    do {
      const page = await service.maintainOrphanObjectPage({
        cutoff,
        apply: true,
        batchSize: 2,
        startAfter,
      })
      objectItems.push(...page.items)
      startAfter = page.nextStartAfter
    } while (startAfter)
    assert.equal(objectItems.find((item) => item.objectKey === bucketOrphanKey)?.action, 'orphan_object_deleted')
    assert.equal(objectItems.find((item) => item.objectKey === recentBucketOrphanKey)?.reason, 'grace_period')
    assert.equal(objectItems.find((item) => item.objectKey === unrecognizedKey)?.action, 'ignored_unmanaged')
    assert.equal(objects.has(bucketOrphanKey), false)
    assert.equal(objects.has(unrecognizedKey), true)

    assert.deepEqual((await pool.query(
      `SELECT version, last_sequence, node_count FROM projects WHERE id = $1`,
      [PROJECT_A],
    )).rows[0], beforeProject)
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM project_changes WHERE project_id = $1`,
      [PROJECT_A],
    )).rows[0]?.count, beforeChanges)
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM project_nodes WHERE project_id = $1 AND deleted_at IS NULL`,
      [PROJECT_A],
    )).rows[0]?.count, 1)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
