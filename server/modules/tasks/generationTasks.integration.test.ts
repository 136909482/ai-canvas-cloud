import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'
const TASK_A = '33333333-3333-4333-8333-333333333333'
const ASSET_A = '44444444-4444-4444-8444-444444444444'

test('PostgreSQL generation task schema isolates workspaces and owns attempts and asset references', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `generation_task_${randomUUID().replaceAll('-', '')}`
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
      VALUES ('task-user-a', 'A', 'task-a@example.com', true),
             ('task-user-b', 'B', 'task-b@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, 'Task A', 'task-user-a'), ($2, 'Task B', 'task-user-b')
    `, [WORKSPACE_A, WORKSPACE_B])
    await pool.query(`
      INSERT INTO projects (id, workspace_id, name)
      VALUES ($1, $2, 'Project A'), ($3, $4, 'Project B')
    `, [PROJECT_A, WORKSPACE_A, PROJECT_B, WORKSPACE_B])
    await pool.query(`
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
      VALUES ($1, 'source-a', 'generate', 0, 0), ($1, 'preview-a', 'preview', 100, 0),
             ($2, 'source-b', 'generate', 0, 0)
    `, [PROJECT_A, PROJECT_B])

    await pool.query(`
      INSERT INTO generation_tasks (
        id, workspace_id, project_id, created_by_user_id, source_node_id,
        preview_node_id, task_kind, provider_id, model_key, request_json, idempotency_key
      ) VALUES (
        $1, $2, $3, 'task-user-a', 'source-a', 'preview-a',
        'image', 'openai', 'gpt-image-2', '{"prompt":"isolated"}'::jsonb, 'task-a'
      )
    `, [TASK_A, WORKSPACE_A, PROJECT_A])
    await pool.query(`
      UPDATE generation_tasks
      SET status = 'running', attempt_count = 1, started_at = now(),
          lease_owner = 'worker-a', lease_token = gen_random_uuid(),
          lease_expires_at = now() + interval '5 minutes'
      WHERE id = $1
    `, [TASK_A])
    await pool.query(`
      INSERT INTO task_attempts (
        workspace_id, task_id, attempt_number, provider_id, model_key,
        submission_key, submission_stage
      ) VALUES ($1, $2, 1, 'openai', 'gpt-image-2', 'provider-submission:task-a:1', 'ready')
    `, [WORKSPACE_A, TASK_A])

    await assert.rejects(
      () => pool!.query(`
        INSERT INTO generation_tasks (
          workspace_id, project_id, created_by_user_id, source_node_id,
          task_kind, provider_id, model_key, idempotency_key
        ) VALUES ($1, $2, 'task-user-b', 'source-a', 'image', 'openai', 'gpt-image-2', 'cross-task')
      `, [WORKSPACE_B, PROJECT_A]),
      /generation_tasks_workspace_project_fk/,
    )
    await assert.rejects(
      () => pool!.query(`
        INSERT INTO generation_tasks (
          workspace_id, project_id, created_by_user_id, source_node_id,
          task_kind, provider_id, model_key, idempotency_key
        ) VALUES ($1, $2, 'task-user-a', 'source-b', 'image', 'openai', 'gpt-image-2', 'cross-node')
      `, [WORKSPACE_A, PROJECT_A]),
      /generation_tasks_source_node_fk/,
    )
    await assert.rejects(
      () => pool!.query(`
        INSERT INTO task_attempts (
          workspace_id, task_id, attempt_number, provider_id, model_key,
          submission_key, submission_stage
        ) VALUES ($1, $2, 2, 'openai', 'gpt-image-2', 'provider-submission:task-a:2', 'ready')
      `, [WORKSPACE_B, TASK_A]),
      /task_attempts_workspace_task_fk/,
    )

    await pool.query(`
      INSERT INTO assets (
        id, workspace_id, origin_project_id, created_by_user_id, object_key,
        mime_type, byte_size, asset_kind, status
      ) VALUES (
        $1, $2, $3, 'task-user-a',
        'workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/projects/11111111-1111-4111-8111-111111111111/generated/2026-07-16/44444444-4444-4444-8444-444444444444.png',
        'image/png', 4, 'generated', 'completed'
      )
    `, [ASSET_A, WORKSPACE_A, PROJECT_A])
    await pool.query(`
      INSERT INTO asset_references (
        workspace_id, asset_id, project_id, task_id, reference_role
      ) VALUES ($1, $2, $3, $4, 'result')
    `, [WORKSPACE_A, ASSET_A, PROJECT_A, TASK_A])
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM asset_references WHERE task_id = $1`,
      [TASK_A],
    )).rows[0]?.count, 1)

    await pool.query(`DELETE FROM generation_tasks WHERE id = $1`, [TASK_A])
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM task_attempts WHERE task_id = $1`,
      [TASK_A],
    )).rows[0]?.count, 0)
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM asset_references WHERE task_id = $1`,
      [TASK_A],
    )).rows[0]?.count, 0)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
