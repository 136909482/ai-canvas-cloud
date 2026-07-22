import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresProjectGraphService } from '../../dist/modules/project-graph/postgresProjectGraphService.js'
import { createPostgresProjectService } from '../../dist/modules/projects/postgresProjectService.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL

test('PostgreSQL graph batches are atomic, idempotent, versioned, and tenant isolated', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `graph_test_${randomUUID().replaceAll('-', '')}`
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
      .filter((fileName) => fileName.endsWith('.sql') && !/^(?:002[5-9]|0030)_/.test(fileName))
      .sort()
    for (const fileName of migrationFiles) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('graph-user-a', 'A', 'a-graph-test@example.com', true),
        ('graph-user-b', 'B', 'b-graph-test@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A workspace', 'graph-user-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B workspace', 'graph-user-b')
    `)
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'graph-user-a', 'owner'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'graph-user-b', 'owner')
    `)

    const projects = createPostgresProjectService(pool)
    const graphs = createPostgresProjectGraphService(pool)
    const actorA = { userId: 'graph-user-a', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    const actorB = { userId: 'graph-user-b', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const projectA = (await projects.createProject({ name: 'Graph A' }, actorA)).project
    const projectB = (await projects.createProject({ name: 'Graph B' }, actorB)).project
    const firstBatch = {
      baseVersion: 0,
      clientId: 'browser_a',
      batchId: 'batch_a_1',
      idempotencyKey: 'graph_a_1',
      operations: [
        {
          type: 'upsertNode' as const,
          node: {
            id: 'node-a',
            nodeType: 'text',
            position: { x: 0, y: 0 },
            dataSchemaVersion: 1,
            data: { text: 'A' },
          },
        },
        {
          type: 'upsertNode' as const,
          node: {
            id: 'node-b',
            nodeType: 'text',
            position: { x: 100, y: 0 },
            parentNodeId: 'node-a',
            dataSchemaVersion: 1,
            data: { text: 'B' },
          },
        },
        {
          type: 'upsertEdge' as const,
          edge: { id: 'edge-a-b', source: 'node-a', target: 'node-b', data: {} },
        },
      ],
    }

    const accepted = await graphs.applyOperations(projectA.id, firstBatch, actorA)
    assert.equal(accepted.version, 1)
    assert.equal(accepted.sequence, 1)
    assert.deepEqual(await graphs.applyOperations(projectA.id, firstBatch, actorA), accepted)

    const graph = await graphs.getGraph(projectA.id, actorA)
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)
    assert.equal(graph.nodes.find((node) => node.id === 'node-b')?.parentNodeId, 'node-a')
    const firstChanges = await graphs.getChanges(projectA.id, 0, actorA)
    assert.equal(firstChanges.version, 1)
    assert.equal(firstChanges.sequence, 1)
    assert.equal(firstChanges.after, 0)
    assert.equal(firstChanges.hasMore, false)
    assert.equal(firstChanges.changes.length, 1)
    assert.equal(firstChanges.changes[0]?.sequence, 1)
    assert.equal(firstChanges.changes[0]?.baseVersion, 0)
    assert.equal(firstChanges.changes[0]?.resultVersion, 1)
    assert.equal(firstChanges.changes[0]?.clientId, 'browser_a')
    assert.equal(firstChanges.changes[0]?.batchId, 'batch_a_1')
    assert.equal(firstChanges.changes[0]?.source, 'user')
    assert.equal('actorUserId' in firstChanges.changes[0]!, false)
    const projectCounts = await pool.query(
      'SELECT version, last_sequence, node_count, edge_count FROM projects WHERE id = $1',
      [projectA.id],
    )
    assert.deepEqual(projectCounts.rows[0], {
      version: '1',
      last_sequence: '1',
      node_count: 2,
      edge_count: 1,
    })
    assert.equal((await pool.query('SELECT 1 FROM project_changes WHERE project_id = $1', [projectA.id])).rowCount, 1)

    await assert.rejects(
      () => graphs.applyOperations(projectA.id, {
        ...firstBatch,
        batchId: 'batch_conflict',
        idempotencyKey: 'graph_conflict',
      }, actorA),
      (error: unknown) => error instanceof AuthServiceError
        && error.apiCode === 'PROJECT_VERSION_CONFLICT'
        && error.details?.currentVersion === 1,
    )

    await assert.rejects(
      () => graphs.applyOperations(projectA.id, {
        baseVersion: 1,
        clientId: 'browser_a',
        batchId: 'batch_cycle',
        idempotencyKey: 'graph_cycle',
        operations: [{
          type: 'upsertNode',
          node: {
            id: 'node-a',
            nodeType: 'text',
            position: { x: 0, y: 0 },
            parentNodeId: 'node-b',
            dataSchemaVersion: 1,
            data: {},
          },
        }],
      }, actorA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )
    assert.equal((await graphs.getGraph(projectA.id, actorA)).version, 1)

    const secondBatch = {
      baseVersion: 1,
      clientId: 'browser_a',
      batchId: 'batch_a_2',
      idempotencyKey: 'graph_a_2',
      operations: [{ type: 'deleteNode' as const, nodeId: 'node-b' }],
    }
    const deleted = await graphs.applyOperations(projectA.id, secondBatch, actorA)
    assert.equal(deleted.version, 2)
    const changesAfterFirst = await graphs.getChanges(projectA.id, 1, actorA)
    assert.deepEqual(changesAfterFirst.changes.map((change) => change.sequence), [2])
    const afterDelete = await graphs.getGraph(projectA.id, actorA)
    assert.deepEqual(afterDelete.nodes.map((node) => node.id), ['node-a'])
    assert.equal(afterDelete.edges.length, 0)

    await projects.archiveProject(projectA.id, actorA)
    assert.deepEqual(await graphs.applyOperations(projectA.id, secondBatch, actorA), deleted)
    await assert.rejects(
      () => graphs.applyOperations(projectA.id, {
        baseVersion: 2,
        clientId: 'browser_a',
        batchId: 'batch_archived',
        idempotencyKey: 'graph_archived',
        operations: [{ type: 'deleteNode', nodeId: 'missing' }],
      }, actorA),
      (error: unknown) => error instanceof AuthServiceError
        && error.statusCode === 403
        && error.apiCode === 'ACCESS_DENIED',
    )

    await assert.rejects(
      () => graphs.getGraph(projectB.id, actorA),
      (error: unknown) => error instanceof AuthServiceError
        && error.statusCode === 404
        && error.apiCode === 'RESOURCE_NOT_FOUND',
    )
    await assert.rejects(
      () => graphs.getChanges(projectB.id, 0, actorA),
      (error: unknown) => error instanceof AuthServiceError
        && error.statusCode === 404
        && error.apiCode === 'RESOURCE_NOT_FOUND',
    )

    const concurrentProject = (await projects.createProject({ name: 'Concurrent' }, actorA)).project
    const concurrentResults = await Promise.allSettled([
      graphs.applyOperations(concurrentProject.id, {
        baseVersion: 0,
        clientId: 'tab_1',
        batchId: 'tab_batch_1',
        idempotencyKey: 'tab_graph_1',
        operations: [{ type: 'deleteNode', nodeId: 'missing-1' }],
      }, actorA),
      graphs.applyOperations(concurrentProject.id, {
        baseVersion: 0,
        clientId: 'tab_2',
        batchId: 'tab_batch_2',
        idempotencyKey: 'tab_graph_2',
        operations: [{ type: 'deleteNode', nodeId: 'missing-2' }],
      }, actorA),
    ])
    assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1)
    const rejected = concurrentResults.find((result) => result.status === 'rejected')
    assert(rejected?.status === 'rejected')
    assert(rejected.reason instanceof AuthServiceError)
    assert.equal(rejected.reason.apiCode, 'PROJECT_VERSION_CONFLICT')
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
