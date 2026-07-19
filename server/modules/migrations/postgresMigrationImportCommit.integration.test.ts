import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresMigrationImportService } from '../../dist/modules/migrations/postgresMigrationImportService.js'
import { readWorkspaceStorageUsage } from '../../dist/modules/workspaces/usage.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const IMPORT_ID = '99999999-9999-4999-8999-999999999991'

function packagePayload(
  projectId = SOURCE_ID,
  projectName = 'Imported commit project',
) {
  return {
    projectRecord: { id: projectId, name: projectName },
    graph: {
      schemaVersion: 1,
      projectId,
      version: 2,
      sequence: 3,
      nodes: [
        {
          id: 'node-1',
          nodeType: 'imageNode',
          position: { x: 0, y: 0 },
          dataSchemaVersion: 1,
          data: { imageAsset: { assetId: 'logical-asset' } },
        },
        {
          id: 'node-2',
          nodeType: 'groupNode',
          position: { x: 10, y: 10 },
          parentNodeId: 'node-1',
          dataSchemaVersion: 1,
          data: {},
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
          edgeType: 'default',
        },
      ],
    },
    assetManifest: {
      schemaVersion: 1,
      assets: [
        {
          logicalAssetId: 'logical-asset',
          filePath: 'assets/logical-asset.png',
          originalFileName: 'source.png',
          mimeType: 'image/png',
          byteSize: 10,
          sha256: 'a'.repeat(64),
          width: 1,
          height: 1,
          assetKind: 'upload',
        },
      ],
    },
  }
}

async function insertImport(
  pool: pg.Pool,
  input: {
    id: string
    projectId?: string
    name?: string
    conflictType?: 'none' | 'project_exists'
    targetProjectId?: string | null
    targetVersion?: number | null
    targetSequence?: number | null
    withCheckpoint?: boolean
  },
) {
  const payload = packagePayload(input.projectId, input.name)
  const checkpoint = input.withCheckpoint
    ? {
        schemaVersion: 1,
        id: 'checkpoint-source',
        projectId: input.projectId ?? SOURCE_ID,
        projectVersion: 2,
        sequence: 3,
        checkpointType: 'import',
        createdAt: '2026-07-18T00:00:00.000Z',
        assetIds: ['logical-asset'],
        record: {
          schemaVersion: 1,
          project: {
            id: input.projectId ?? SOURCE_ID,
            name: input.name ?? 'Imported commit project',
            version: 2,
            lastSequence: 3,
          },
          canvas: payload.graph,
          taskQueue: { tasks: [] },
        },
      }
    : null
  await pool.query(
    `
    INSERT INTO migration_imports (
      id, workspace_id, created_by_user_id, package_schema_version, package_id,
      source_platform, source_project_id, source_project_version, source_project_sequence,
      project_name, request_fingerprint, content_sha256, idempotency_key,
      status, conflict_type, target_project_id, target_project_name, target_expected_version, target_expected_sequence,
      asset_count, total_file_count, total_bytes, estimated_storage_bytes,
      available_bytes_at_prepare, manifest_json, project_record_json, graph_json, asset_manifest_json, checkpoint_json, expires_at
    ) VALUES (
      $1, $2, 'commit-owner-a', 1, $3, 'electron', $4, 2, 3, $5, repeat('a', 64), repeat('b', 64), $6,
      'ready', $7::varchar, $8, CASE WHEN $7::varchar = 'project_exists' THEN $5::varchar ELSE NULL::varchar END, $9, $10, 1, 5, 10, 10, 1000, '{}'::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
      now() + interval '1 day'
    )
  `,
    [
      input.id,
      WORKSPACE_A,
      `package-${input.id}`,
      input.projectId ?? SOURCE_ID,
      input.name ?? 'Imported commit project',
      `prepare-${input.id}`,
      input.conflictType ?? 'none',
      input.targetProjectId ?? null,
      input.targetVersion ?? null,
      input.targetSequence ?? null,
      JSON.stringify(payload.projectRecord),
      JSON.stringify(payload.graph),
      JSON.stringify(payload.assetManifest),
      checkpoint ? JSON.stringify(checkpoint) : null,
    ],
  )
  await pool.query(
    `
    INSERT INTO migration_import_asset_uploads (
      workspace_id, import_id, logical_asset_id, object_key, upload_mode, part_size, part_count,
      expected_file_path, expected_original_file_name, expected_mime_type, expected_byte_size,
      expected_sha256, expected_width, expected_height, expected_asset_kind, status, uploaded_byte_size,
      completed_at, expires_at
    ) VALUES ($1, $2, 'logical-asset', $3, 'single', 8, 1, 'assets/logical-asset.png', 'source.png',
      'image/png', 10, repeat('a', 64), 1, 1, 'upload', 'completed', 10, now(), now() + interval '1 day')
  `,
    [
      WORKSPACE_A,
      input.id,
      `workspaces/${WORKSPACE_A}/migration-imports/${input.id}/logical-asset-staging.png`,
    ],
  )
}

test(
  'migration commit materializes copy/replace atomically and is idempotent',
  {
    skip: databaseUrl ? false : 'DATABASE_URL is not configured',
  },
  async () => {
    const schemaName = `migration_commit_${randomUUID().replaceAll('-', '')}`
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
      const migrations = (
        await readdir(join(process.cwd(), 'server', 'db', 'migrations'))
      )
        .filter((fileName) => fileName.endsWith('.sql'))
        .sort()
      for (const fileName of migrations) {
        await pool.query(
          await readFile(
            join(process.cwd(), 'server', 'db', 'migrations', fileName),
            'utf8',
          ),
        )
      }
      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('commit-owner-a', 'Commit A', 'commit-a@example.com', true),
             ('commit-owner-b', 'Commit B', 'commit-b@example.com', true),
             ('commit-editor', 'Commit Editor', 'commit-editor@example.com', true)
    `)
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id, storage_quota_bytes)
      VALUES ($1, 'Commit A', 'commit-owner-a', 1000), ($2, 'Commit B', 'commit-owner-b', 1000)
    `,
        [WORKSPACE_A, WORKSPACE_B],
      )
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'commit-owner-a', 'owner'), ($1, 'commit-editor', 'editor'), ($2, 'commit-owner-b', 'owner')
    `,
        [WORKSPACE_A, WORKSPACE_B],
      )
      const crossWorkspaceAssetId = (
        await pool.query<{ id: string }>(
          `
      INSERT INTO assets (
        workspace_id, created_by_user_id, object_key, original_file_name,
        mime_type, byte_size, sha256, width, height, asset_kind, status
      ) VALUES ($1, 'commit-owner-b', $2, 'same-content.png', 'image/png', 10, repeat('a', 64), 1, 1, 'upload', 'completed')
      RETURNING id::text
    `,
          [WORKSPACE_B, `workspaces/${WORKSPACE_B}/assets/same-content.png`],
        )
      ).rows[0]!.id
      await insertImport(pool, { id: IMPORT_ID, withCheckpoint: true })

      const service = createPostgresMigrationImportService(pool)
      const owner = { userId: 'commit-owner-a', workspaceId: WORKSPACE_A }
      const editor = { userId: 'commit-editor', workspaceId: WORKSPACE_A }
      const otherWorkspace = {
        userId: 'commit-owner-b',
        workspaceId: WORKSPACE_B,
      }
      const committed = await service.commitImport(
        IMPORT_ID,
        { idempotencyKey: 'commit-1', strategy: 'copy' },
        owner,
      )
      assert.equal(committed.status, 'completed')
      assert.equal(committed.assetCount, 1)
      assert(committed.checkpoint)
      assert.equal(committed.project.version, 1)
      assert.equal(committed.project.sequence, 1)
      assert.notEqual(committed.project.id, SOURCE_ID)
      const importedNodes = (
        await pool.query<{
          node_id: string
          parent_node_id: string | null
          data_json: { imageAsset?: { assetId?: string } }
        }>(
          `SELECT node_id, parent_node_id, data_json FROM project_nodes WHERE project_id = $1 ORDER BY created_at, node_id`,
          [committed.project.id],
        )
      ).rows
      assert.equal(importedNodes.length, 2)
      const importedImageNode = importedNodes.find(
        (node) => node.data_json.imageAsset,
      )
      const importedChildNode = importedNodes.find(
        (node) => node.parent_node_id,
      )
      assert(importedImageNode)
      assert(importedChildNode)
      assert.notEqual(importedImageNode.node_id, 'node-1')
      assert.notEqual(importedChildNode.node_id, 'node-2')
      assert.equal(importedChildNode.parent_node_id, importedImageNode.node_id)
      const importedEdge = (
        await pool.query<{
          edge_id: string
          source_node_id: string
          target_node_id: string
        }>(
          `SELECT edge_id, source_node_id, target_node_id FROM project_edges WHERE project_id = $1`,
          [committed.project.id],
        )
      ).rows[0]
      assert(importedEdge)
      assert.notEqual(importedEdge.edge_id, 'edge-1')
      assert.equal(importedEdge.source_node_id, importedImageNode.node_id)
      assert.equal(importedEdge.target_node_id, importedChildNode.node_id)
      const importedCheckpoint = (
        await pool.query<{
          record_json: {
            canvas: {
              nodes: Array<{ id: string }>
              edges: Array<{ id: string; source: string; target: string }>
            }
          }
        }>(
          `
      SELECT record_json FROM project_snapshots WHERE project_id = $1 AND snapshot_type = 'import'
    `,
          [committed.project.id],
        )
      ).rows[0]?.record_json
      assert(importedCheckpoint)
      assert.deepEqual(
        importedCheckpoint.canvas.nodes.map((node) => node.id).sort(),
        importedNodes.map((node) => node.node_id).sort(),
      )
      assert.deepEqual(
        importedCheckpoint.canvas.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
        [
          {
            id: importedEdge.edge_id,
            source: importedEdge.source_node_id,
            target: importedEdge.target_node_id,
          },
        ],
      )
      const referencedAsset = (
        await pool.query(
          `SELECT asset_id::text AS asset_id FROM asset_references WHERE project_id = $1`,
          [committed.project.id],
        )
      ).rows[0]?.asset_id
      assert.equal(
        importedImageNode.data_json.imageAsset?.assetId,
        referencedAsset,
      )
      assert.notEqual(referencedAsset, crossWorkspaceAssetId)
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM asset_references WHERE project_id = $1`,
            [committed.project.id],
          )
        ).rows[0]?.count,
        1,
      )
      assert.equal(
        (
          await pool.query(
            `SELECT source FROM project_changes WHERE project_id = $1`,
            [committed.project.id],
          )
        ).rows[0]?.source,
        'import',
      )
      assert.equal(
        (
          await pool.query(`SELECT status FROM assets WHERE id = $1`, [
            referencedAsset,
          ])
        ).rows[0]?.status,
        'completed',
      )
      assert.deepEqual(
        (await readWorkspaceStorageUsage(pool, WORKSPACE_A)).storage,
        {
          usedBytes: 10,
          reservedBytes: 0,
          totalBytes: 10,
          quotaBytes: 1000,
          availableBytes: 990,
        },
      )

      const duplicateImportId = '99999999-9999-4999-8999-999999999993'
      await insertImport(pool, { id: duplicateImportId })
      const duplicate = await service.commitImport(
        duplicateImportId,
        {
          idempotencyKey: 'duplicate-copy',
          strategy: 'copy',
        },
        owner,
      )
      const duplicateReferencedAsset = (
        await pool.query(
          `
      SELECT asset_id::text AS asset_id FROM asset_references WHERE project_id = $1
    `,
          [duplicate.project.id],
        )
      ).rows[0]?.asset_id
      assert.equal(duplicateReferencedAsset, referencedAsset)
      assert.equal(
        (
          await pool.query(
            `
      SELECT count(*)::integer AS count FROM assets WHERE workspace_id = $1 AND deleted_at IS NULL
    `,
            [WORKSPACE_A],
          )
        ).rows[0]?.count,
        1,
      )
      const duplicateNodeIds = (
        await pool.query<{ node_id: string }>(
          `
      SELECT node_id FROM project_nodes WHERE project_id = $1 ORDER BY node_id
    `,
          [duplicate.project.id],
        )
      ).rows.map((row) => row.node_id)
      assert.equal(duplicateNodeIds.length, 2)
      assert.equal(
        duplicateNodeIds.some((nodeId) =>
          importedNodes.some((node) => node.node_id === nodeId),
        ),
        false,
      )
      const duplicateEdgeId = (
        await pool.query<{ edge_id: string }>(
          `
      SELECT edge_id FROM project_edges WHERE project_id = $1
    `,
          [duplicate.project.id],
        )
      ).rows[0]?.edge_id
      assert.notEqual(duplicateEdgeId, importedEdge.edge_id)
      assert.deepEqual(
        (await readWorkspaceStorageUsage(pool, WORKSPACE_A)).storage,
        {
          usedBytes: 10,
          reservedBytes: 0,
          totalBytes: 10,
          quotaBytes: 1000,
          availableBytes: 990,
        },
      )

      const replay = await service.commitImport(
        IMPORT_ID,
        { idempotencyKey: 'commit-1', strategy: 'copy' },
        owner,
      )
      assert.deepEqual(replay, committed)
      await assert.rejects(
        () =>
          service.commitImport(
            IMPORT_ID,
            { idempotencyKey: 'different', strategy: 'copy' },
            owner,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === 'IMPORT_CONFLICT',
      )
      await assert.rejects(
        () =>
          service.commitImport(
            IMPORT_ID,
            { idempotencyKey: 'cross-workspace', strategy: 'copy' },
            otherWorkspace,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === 'RESOURCE_NOT_FOUND',
      )

      const replaceImportId = '99999999-9999-4999-8999-999999999992'
      const replaceProjectId = '22222222-2222-4222-8222-222222222222'
      await pool.query(
        `INSERT INTO projects (id, workspace_id, name, version, last_sequence) VALUES ($1, $2, 'Replace target', 0, 0)`,
        [replaceProjectId, WORKSPACE_A],
      )
      await insertImport(pool, {
        id: replaceImportId,
        projectId: replaceProjectId,
        name: 'Replace target',
        conflictType: 'project_exists',
        targetProjectId: replaceProjectId,
        targetVersion: 0,
        targetSequence: 0,
      })
      await assert.rejects(
        () =>
          service.commitImport(
            replaceImportId,
            {
              idempotencyKey: 'replace-editor',
              strategy: 'replace',
              expectedVersion: 0,
              expectedSequence: 0,
              confirmReplace: true,
            },
            editor,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === 'ACCESS_DENIED',
      )
      await assert.rejects(
        () =>
          service.commitImport(
            replaceImportId,
            {
              idempotencyKey: 'replace-conflict',
              strategy: 'replace',
              expectedVersion: 1,
              expectedSequence: 0,
              confirmReplace: true,
            },
            owner,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === 'PROJECT_VERSION_CONFLICT',
      )
      const replaced = await service.commitImport(
        replaceImportId,
        {
          idempotencyKey: 'replace-owner',
          strategy: 'replace',
          expectedVersion: 0,
          expectedSequence: 0,
          confirmReplace: true,
        },
        owner,
      )
      assert.equal(replaced.project.id, replaceProjectId)
      assert.equal(replaced.project.version, 1)
      assert.deepEqual(
        (
          await pool.query<{ node_id: string }>(
            `
      SELECT node_id FROM project_nodes WHERE project_id = $1 AND deleted_at IS NULL ORDER BY node_id
    `,
            [replaceProjectId],
          )
        ).rows.map((row) => row.node_id),
        ['node-1', 'node-2'],
      )
      assert.equal(
        (
          await pool.query<{ edge_id: string }>(
            `
      SELECT edge_id FROM project_edges WHERE project_id = $1 AND deleted_at IS NULL
    `,
            [replaceProjectId],
          )
        ).rows[0]?.edge_id,
        'edge-1',
      )

      const concurrentImportId = '99999999-9999-4999-8999-999999999994'
      const concurrentProjectId = '33333333-3333-4333-8333-333333333333'
      await pool.query(
        `INSERT INTO projects (id, workspace_id, name, version, last_sequence) VALUES ($1, $2, 'Concurrent target', 0, 0)`,
        [concurrentProjectId, WORKSPACE_A],
      )
      await insertImport(pool, {
        id: concurrentImportId,
        projectId: concurrentProjectId,
        name: 'Concurrent target',
        conflictType: 'project_exists',
        targetProjectId: concurrentProjectId,
        targetVersion: 0,
        targetSequence: 0,
      })
      await pool.query(
        `
      INSERT INTO project_changes (
        project_id, sequence, base_version, result_version, actor_user_id,
        batch_id, idempotency_key, source, operations_json
      ) VALUES ($1, 1, 0, 1, 'commit-owner-a', 'concurrent-edit', 'concurrent-edit', 'user', '[]'::jsonb)
    `,
        [concurrentProjectId],
      )
      await pool.query(
        `UPDATE projects SET version = 1, last_sequence = 1 WHERE id = $1`,
        [concurrentProjectId],
      )
      const assetCountBeforeConflict = (
        await pool.query(
          `
      SELECT count(*)::integer AS count FROM assets WHERE workspace_id = $1
    `,
          [WORKSPACE_A],
        )
      ).rows[0]?.count
      await assert.rejects(
        () =>
          service.commitImport(
            concurrentImportId,
            {
              idempotencyKey: 'concurrent-replace',
              strategy: 'replace',
              expectedVersion: 0,
              expectedSequence: 0,
              confirmReplace: true,
            },
            owner,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === 'PROJECT_VERSION_CONFLICT',
      )
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM assets WHERE workspace_id = $1`,
            [WORKSPACE_A],
          )
        ).rows[0]?.count,
        assetCountBeforeConflict,
      )
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM project_changes WHERE project_id = $1`,
            [concurrentProjectId],
          )
        ).rows[0]?.count,
        1,
      )
      assert.equal(
        (
          await pool.query(
            `SELECT committed_asset_id FROM migration_import_asset_uploads WHERE import_id = $1`,
            [concurrentImportId],
          )
        ).rows[0]?.committed_asset_id,
        null,
      )
      assert.equal(
        (
          await pool.query(
            `SELECT status FROM migration_imports WHERE id = $1`,
            [concurrentImportId],
          )
        ).rows[0]?.status,
        'ready',
      )
    } finally {
      await pool?.end()
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      }
      await admin.end()
    }
  },
)
