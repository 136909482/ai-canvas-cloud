import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresGenerationTaskService } from '../../dist/modules/tasks/service.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'

function request(idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_A,
    sourceNodeId: 'source-a',
    previewNodeId: 'preview-a',
    kind: 'image' as const,
    providerId: 'openai',
    model: 'gpt-image-2',
    parameters: { prompt: idempotencyKey },
    idempotencyKey,
    ...overrides,
  }
}

test('PostgreSQL generation task service is idempotent, bounded, command-safe, and workspace isolated', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `generation_task_service_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  let pool: pg.Pool | undefined
  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 30_000,
      max: 3,
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
      VALUES ('task-owner-a', 'A', 'task-service-a@example.com', true),
             ('task-owner-b', 'B', 'task-service-b@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, 'Tasks A', 'task-owner-a'), ($2, 'Tasks B', 'task-owner-b')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, 'task-owner-a', 'owner'), ($2, 'task-owner-b', 'owner')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO projects (id, workspace_id, name)
      VALUES ($1, $2, 'Project A'), ($3, $4, 'Project B')
    `, [PROJECT_A, WORKSPACE_A, PROJECT_B, WORKSPACE_B])
    await pool.query(`
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
      VALUES ($1, 'source-a', 'generate', 0, 0), ($1, 'preview-a', 'preview', 10, 0),
             ($2, 'source-b', 'generate', 0, 0)
    `, [PROJECT_A, PROJECT_B])
    const envelope = JSON.stringify({
      algorithm: 'aes-256-gcm', keyVersion: 1, iv: 'iv', ciphertext: 'ciphertext', authTag: 'tag',
    })
    await pool.query(`
      INSERT INTO provider_credentials (
        workspace_id, provider_id, base_url, encrypted_secret_json, key_version,
        secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES ($1, 'openai', 'https://api.openai.com', $2::jsonb, 1, '1234', 'task-owner-a', 'task-owner-a')
    `, [WORKSPACE_A, envelope])

    const service = createPostgresGenerationTaskService(pool)
    const actorA = { userId: 'task-owner-a', workspaceId: WORKSPACE_A }
    const actorB = { userId: 'task-owner-b', workspaceId: WORKSPACE_B }
    const created = await service.createTask(request('same-create'), actorA)
    const replay = await service.createTask(request('same-create'), actorA)
    assert.equal(replay.task.id, created.task.id)
    assert.equal((await pool.query(`SELECT task_count FROM projects WHERE id = $1`, [PROJECT_A])).rows[0]?.task_count, 1)
    await assert.rejects(
      () => service.createTask(request('same-create', { model: 'different-model' }), actorA),
      (error: unknown) => error instanceof AuthServiceError && error.statusCode === 409,
    )
    await assert.rejects(
      () => service.createTask(request('cross-node', { sourceNodeId: 'source-b' }), actorA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'RESOURCE_NOT_FOUND',
    )
    await assert.rejects(
      () => service.getTask(created.task.id, actorB),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'RESOURCE_NOT_FOUND',
    )

    const canceled = await service.cancelTask(created.task.id, { idempotencyKey: 'cancel-one' }, actorA)
    assert.equal(canceled.task.status, 'canceled')
    assert.equal((await service.cancelTask(created.task.id, { idempotencyKey: 'cancel-one' }, actorA)).task.status, 'canceled')
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM task_commands WHERE idempotency_key = 'cancel-one'`)).rows[0]?.count, 1)

    const failed = await service.createTask(request('retry-create'), actorA)
    await pool.query(`
      UPDATE generation_tasks SET status = 'failed', attempt_count = 1,
        error_code = 'UPSTREAM', error_message = 'redacted', finished_at = now(), updated_at = now()
      WHERE id = $1
    `, [failed.task.id])
    const retried = await service.retryTask(failed.task.id, { idempotencyKey: 'retry-one' }, actorA)
    assert.equal(retried.task.status, 'queued')
    assert.equal(retried.task.errorCode, null)
    assert.equal((await service.retryTask(failed.task.id, { idempotencyKey: 'retry-one' }, actorA)).task.id, failed.task.id)
    await service.cancelTask(failed.task.id, { idempotencyKey: 'cancel-retry' }, actorA)

    const running = await service.createTask(request('running-create'), actorA)
    await pool.query(`
      UPDATE generation_tasks SET status = 'running', attempt_count = 1, started_at = now(),
        lease_owner = 'worker', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes'
      WHERE id = $1
    `, [running.task.id])
    const cancelRequested = await service.cancelTask(running.task.id, { idempotencyKey: 'cancel-running' }, actorA)
    assert.equal(cancelRequested.task.status, 'running')
    assert.notEqual(cancelRequested.task.cancelRequestedAt, null)
    await pool.query(`
      UPDATE generation_tasks SET status = 'canceled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, finished_at = now(), updated_at = now() WHERE id = $1
    `, [running.task.id])

    const concurrent = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => service.createTask(request(`bounded-${index}`), actorA)),
    )
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 5)
    const rejected = concurrent.find((result) => result.status === 'rejected')
    assert(rejected?.status === 'rejected')
    assert(
      rejected.reason instanceof AuthServiceError,
      `Unexpected concurrency rejection: ${JSON.stringify({
        name: rejected.reason?.constructor?.name,
        code: rejected.reason?.apiCode ?? rejected.reason?.code,
        message: rejected.reason?.message,
      })}`,
    )
    assert.equal(rejected.reason.apiCode, 'TASK_CONCURRENCY_LIMIT')
    assert.equal((await service.listTasks({ limit: 3 }, actorA)).tasks.length, 3)
    await assert.rejects(
      () => service.listTasks({ status: 'secret-internal-state' }, actorA),
      (error: unknown) => error instanceof AuthServiceError && error.apiCode === 'VALIDATION_FAILED',
    )
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM generation_tasks WHERE workspace_id = $1`, [WORKSPACE_B])).rows[0]?.count, 0)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
