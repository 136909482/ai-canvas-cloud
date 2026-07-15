import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresProjectService } from '../../dist/modules/projects/postgresProjectService.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL

test('PostgreSQL project service isolates two workspaces through real constraints and queries', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `project_test_${randomUUID().replaceAll('-', '')}`
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })

  try {
    await pool.query(`CREATE SCHEMA "${schemaName}"`)
    await pool.query(`SET search_path TO "${schemaName}", public`)

    for (const fileName of [
      '0001_schema_migrations.sql',
      '0002_auth_workspaces.sql',
      '0003_project_graph.sql',
      '0004_project_snapshot_scope.sql',
    ]) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('user-a', 'A', 'a-project-test@example.com', true),
        ('user-b', 'B', 'b-project-test@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A workspace', 'user-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B workspace', 'user-b')
    `)
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user-a', 'owner'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user-b', 'owner')
    `)

    const service = createPostgresProjectService(pool)
    const actorA = { userId: 'user-a', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    const actorB = { userId: 'user-b', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const clientProjectId = '11111111-1111-4111-8111-111111111111'
    const createdA = await service.createProject({ id: clientProjectId, name: 'A project' }, actorA)
    const retriedA = await service.createProject({ id: clientProjectId, name: 'A project' }, actorA)
    const createdB = await service.createProject({ name: 'B project' }, actorB)

    assert.equal(createdA.project.id, clientProjectId)
    assert.deepEqual(retriedA, createdA)

    assert.deepEqual((await service.listProjects({}, actorA)).projects.map((project) => project.id), [createdA.project.id])
    assert.deepEqual((await service.listProjects({}, actorB)).projects.map((project) => project.id), [createdB.project.id])
    await assert.rejects(
      () => service.getProject(createdB.project.id, actorA),
      (error: unknown) => error instanceof AuthServiceError
        && error.statusCode === 404
        && error.apiCode === 'RESOURCE_NOT_FOUND',
    )

    const archived = await service.archiveProject(createdA.project.id, actorA)
    assert(archived.project.archivedAt)
    assert.equal((await service.listProjects({ status: 'active' }, actorA)).projects.length, 0)
    assert.equal((await service.listProjects({ status: 'archived' }, actorA)).projects.length, 1)

    await service.restoreProject(createdA.project.id, actorA)
    await service.renameProject(createdA.project.id, { name: 'A renamed' }, actorA)
    assert.equal((await service.getProject(createdA.project.id, actorA)).project.name, 'A renamed')
    await service.deleteProject(createdA.project.id, actorA)
    await assert.rejects(() => service.getProject(createdA.project.id, actorA), AuthServiceError)
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await pool.end()
  }
})
