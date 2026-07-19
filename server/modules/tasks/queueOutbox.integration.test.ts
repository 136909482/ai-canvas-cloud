import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import {
  createPostgresTaskQueueOutboxDispatcher,
  type TaskQueueDispatchJob,
} from '../../dist/modules/tasks/queueOutbox.js'
import { createPostgresGenerationTaskService } from '../../dist/modules/tasks/service.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function request(idempotencyKey: string) {
  return {
    projectId: PROJECT_ID,
    sourceNodeId: 'source',
    kind: 'image' as const,
    providerId: 'openai',
    model: 'gpt-image-2',
    parameters: { prompt: idempotencyKey },
    idempotencyKey,
  }
}

test('PostgreSQL task outbox is transactional, retryable, and safe across dispatchers', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `task_outbox_${randomUUID().replaceAll('-', '')}`
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
    const migrations = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort()
    for (const fileName of migrations) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }
    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('outbox-owner', 'Owner', 'outbox@example.com', true);
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ('${WORKSPACE_ID}', 'Outbox workspace', 'outbox-owner');
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('${WORKSPACE_ID}', 'outbox-owner', 'owner');
      INSERT INTO projects (id, workspace_id, name)
      VALUES ('${PROJECT_ID}', '${WORKSPACE_ID}', 'Outbox project');
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
      VALUES ('${PROJECT_ID}', 'source', 'generate', 0, 0);
    `)
    const envelope = JSON.stringify({
      algorithm: 'aes-256-gcm', keyVersion: 1, iv: 'iv', ciphertext: 'ciphertext', authTag: 'tag',
    })
    await pool.query(`
      INSERT INTO provider_credentials (
        workspace_id, provider_id, base_url, encrypted_secret_json, key_version,
        secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES ($1, 'openai', 'https://api.openai.com', $2::jsonb, 1, '1234', 'outbox-owner', 'outbox-owner')
    `, [WORKSPACE_ID, envelope])

    const service = createPostgresGenerationTaskService(pool)
    const actor = { userId: 'outbox-owner', workspaceId: WORKSPACE_ID }
    const tasks = await Promise.all([
      service.createTask(request('outbox-1'), actor),
      service.createTask(request('outbox-2'), actor),
      service.createTask(request('outbox-3'), actor),
    ])
    await service.createTask(request('outbox-1'), actor)
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM task_queue_outbox`)).rows[0]?.count, 3)

    const published: TaskQueueDispatchJob[] = []
    const publisher = {
      async publish(job: TaskQueueDispatchJob) {
        published.push(job)
        await Promise.resolve()
      },
    }
    const dispatcherA = createPostgresTaskQueueOutboxDispatcher(pool, {
      owner: 'dispatcher-a', publisher, batchSize: 2,
    })
    const dispatcherB = createPostgresTaskQueueOutboxDispatcher(pool, {
      owner: 'dispatcher-b', publisher, batchSize: 2,
    })
    const results = await Promise.all([dispatcherA.dispatchOnce(), dispatcherB.dispatchOnce()])
    assert.equal(results.reduce((sum, result) => sum + result.published, 0), 3)
    assert.equal(new Set(published.map((job) => job.outboxId)).size, 3)
    assert(published.every((job) => Object.keys(job).sort().join(',') === 'outboxId,taskId'))
    assert.equal((await dispatcherA.dispatchOnce()).claimed, 0)

    const failedTask = await service.createTask(request('outbox-failure'), actor)
    const failing = createPostgresTaskQueueOutboxDispatcher(pool, {
      owner: 'dispatcher-failing',
      publisher: { async publish() { throw new Error('redis://secret@localhost password=hunter2') } },
      retryBaseMs: 1,
      retryMaxMs: 1,
    })
    assert.deepEqual(await failing.dispatchOnce(), { claimed: 1, published: 0, failed: 1 })
    const failure = await pool.query(`
      SELECT claim_token, last_error FROM task_queue_outbox WHERE task_id = $1
    `, [failedTask.task.id])
    assert.equal(failure.rows[0]?.claim_token, null)
    assert.equal(String(failure.rows[0]?.last_error).includes('secret'), false)
    assert.equal(String(failure.rows[0]?.last_error).includes('hunter2'), false)
    await pool.query(`UPDATE task_queue_outbox SET available_at = now() WHERE task_id = $1`, [failedTask.task.id])
    assert.equal((await dispatcherA.dispatchOnce()).published, 1)

    const retryTask = tasks[0]!
    await pool.query(`
      UPDATE generation_tasks SET status = 'failed', attempt_count = 1,
        finished_at = now(), updated_at = now() WHERE id = $1
    `, [retryTask.task.id])
    await service.retryTask(retryTask.task.id, { idempotencyKey: 'outbox-retry' }, actor)
    const dispatchKeys = await pool.query<{ dispatch_key: string }>(`
      SELECT dispatch_key FROM task_queue_outbox WHERE task_id = $1 ORDER BY dispatch_key
    `, [retryTask.task.id])
    assert.deepEqual(dispatchKeys.rows.map((row) => row.dispatch_key), [
      `run:${retryTask.task.id}:1`,
      `run:${retryTask.task.id}:2`,
    ])
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
