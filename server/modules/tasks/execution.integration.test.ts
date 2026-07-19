import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { createPostgresGenerationTaskExecutionService } from '../../dist/modules/tasks/execution.js'
import { extractNodeAssetReferences } from '../../dist/modules/project-graph/assetReferences.js'

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

test('PostgreSQL task execution claims, fences, settles, and recovers leases', {
  skip: databaseUrl ? false : 'DATABASE_URL is not configured',
}, async () => {
  const schemaName = `task_execution_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  let pool: pg.Pool | undefined
  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 5,
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
      VALUES ('execution-owner', 'Owner', 'execution@example.com', true);
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ('${WORKSPACE_ID}', 'Execution workspace', 'execution-owner');
      INSERT INTO projects (id, workspace_id, name)
      VALUES ('${PROJECT_ID}', '${WORKSPACE_ID}', 'Execution project');
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
      VALUES ('${PROJECT_ID}', 'source', 'generate', 0, 0);
      INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y, data_json)
      VALUES ('${PROJECT_ID}', 'preview', 'generatedPreview', 42, 84, '{"userNote":"preserve"}'::jsonb);
    `)

    async function insertTask(maxAttempts = 3, previewNodeId: string | null = null) {
      const taskId = randomUUID()
      await pool!.query(`
        INSERT INTO generation_tasks (
          id, workspace_id, project_id, created_by_user_id, source_node_id,
          preview_node_id, task_kind, provider_id, model_key, request_json, idempotency_key, max_attempts
        ) VALUES ($1, $2, $3, 'execution-owner', 'source', $4, 'image', 'openai',
          'gpt-image-2', '{"prompt":"execution"}'::jsonb, $5, $6)
      `, [taskId, WORKSPACE_ID, PROJECT_ID, previewNodeId, `execution-${taskId}`, maxAttempts])
      return taskId
    }

    let service = createPostgresGenerationTaskExecutionService(pool)
    const sourceAssetId = randomUUID()
    await pool.query(`
      INSERT INTO assets (
        id, workspace_id, origin_project_id, created_by_user_id, object_key,
        original_file_name, mime_type, byte_size, sha256, asset_kind, status
      ) VALUES ($1, $2, $3, 'execution-owner', $4, 'source.png', 'image/png', 8, $5, 'upload', 'completed')
    `, [sourceAssetId, WORKSPACE_ID, PROJECT_ID, `workspaces/${WORKSPACE_ID}/uploads/source.png`, 'c'.repeat(64)])
    await pool.query(`
      INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
      VALUES ($2, $1, $3, 'source', 'source')
    `, [sourceAssetId, WORKSPACE_ID, PROJECT_ID])
    const sourceTaskId = await insertTask()
    const sourceLease = (await service.claimTask({ taskId: sourceTaskId, workerId: 'source-reader' }))!
    assert.deepEqual(await service.getSourceAsset({
      taskId: sourceTaskId,
      workerId: sourceLease.workerId,
      leaseToken: sourceLease.leaseToken,
    }), {
      objectKey: `workspaces/${WORKSPACE_ID}/uploads/source.png`,
      mimeType: 'image/png',
    })
    assert.equal(await service.getSourceAsset({
      taskId: sourceTaskId,
      workerId: sourceLease.workerId,
      leaseToken: randomUUID(),
    }), null)
    await service.settleCanceled({
      taskId: sourceTaskId,
      workerId: sourceLease.workerId,
      leaseToken: sourceLease.leaseToken,
    })
    const claimedTaskId = await insertTask()
    const claims = await Promise.all([
      service.claimTask({ taskId: claimedTaskId, workerId: 'worker-a', leaseTtlMs: 60_000 }),
      service.claimTask({ taskId: claimedTaskId, workerId: 'worker-b', leaseTtlMs: 60_000 }),
    ])
    const lease = claims.find((claim) => claim !== null)!
    assert.equal(claims.filter(Boolean).length, 1)
    assert.equal(lease.attemptNumber, 1)
    assert.deepEqual(lease.parameters, { prompt: 'execution' })
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS count FROM task_attempts WHERE task_id = $1 AND status = 'running'`,
      [claimedTaskId],
    )).rows[0]?.count, 1)

    const stale = await service.renewLease({
      taskId: claimedTaskId,
      workerId: lease.workerId,
      leaseToken: randomUUID(),
    })
    assert.equal(stale.renewed, false)
    assert.equal((await service.updateProgress({
      taskId: claimedTaskId,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      progress: 60,
    })).renewed, true)
    await service.updateProgress({
      taskId: claimedTaskId,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      progress: 20,
    })
    assert.equal((await pool.query(`SELECT progress FROM generation_tasks WHERE id = $1`, [claimedTaskId])).rows[0]?.progress, 60)

    await pool.query(`UPDATE generation_tasks SET cancel_requested_at = now() WHERE id = $1`, [claimedTaskId])
    assert.equal((await service.renewLease({
      taskId: claimedTaskId,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
    })).cancelRequested, true)
    assert.deepEqual(await service.settleCanceled({
      taskId: claimedTaskId,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
    }), { settled: true, status: 'canceled' })
    assert.equal((await pool.query(`SELECT status FROM task_attempts WHERE task_id = $1`, [claimedTaskId])).rows[0]?.status, 'canceled')

    const retryTaskId = await insertTask(2)
    const firstRetryLease = (await service.claimTask({ taskId: retryTaskId, workerId: 'worker-a' }))!
    assert.deepEqual(await service.settleFailure({
      taskId: retryTaskId,
      workerId: firstRetryLease.workerId,
      leaseToken: firstRetryLease.leaseToken,
      retryable: true,
      errorCode: 'UPSTREAM_TIMEOUT',
      errorMessage: 'redis://secret@localhost password=hunter2',
      retryDelayMs: 1_000,
    }), { settled: true, status: 'queued' })
    const retryState = await pool.query(`
      SELECT task.status, task.error_message, task.available_at,
             outbox.available_at AS outbox_available_at, outbox.dispatch_key
      FROM generation_tasks task
      JOIN task_queue_outbox outbox ON outbox.task_id = task.id
      WHERE task.id = $1 AND outbox.dispatch_key LIKE '%:2'
    `, [retryTaskId])
    assert.equal(retryState.rows[0]?.status, 'queued')
    assert.equal(String(retryState.rows[0]?.error_message).includes('hunter2'), false)
    assert(new Date(retryState.rows[0]?.outbox_available_at).getTime() >= new Date(retryState.rows[0]?.available_at).getTime() - 10)
    await pool.query(`UPDATE generation_tasks SET available_at = now() WHERE id = $1`, [retryTaskId])
    await pool.query(`UPDATE task_queue_outbox SET available_at = now() WHERE task_id = $1`, [retryTaskId])
    const secondRetryLease = (await service.claimTask({ taskId: retryTaskId, workerId: 'worker-b' }))!
    assert.equal(secondRetryLease.attemptNumber, 2)
    assert.deepEqual(await service.settleFailure({
      taskId: retryTaskId,
      workerId: secondRetryLease.workerId,
      leaseToken: secondRetryLease.leaseToken,
      retryable: true,
      errorCode: 'UPSTREAM_TIMEOUT',
      errorMessage: 'again',
    }), { settled: true, status: 'failed' })
    assert.equal((await service.settleFailure({
      taskId: retryTaskId,
      workerId: secondRetryLease.workerId,
      leaseToken: secondRetryLease.leaseToken,
      retryable: true,
      errorCode: 'STALE_WORKER',
      errorMessage: 'stale',
    })).settled, false)

    const expiredRetryId = await insertTask(2)
    const expiredCancelId = await insertTask(2)
    const expiredFinalId = await insertTask(1)
    for (const [taskId, workerId] of [
      [expiredRetryId, 'expired-a'],
      [expiredCancelId, 'expired-b'],
      [expiredFinalId, 'expired-c'],
    ] as const) {
      await service.claimTask({ taskId, workerId, leaseTtlMs: 1 })
    }
    await pool.query(`UPDATE generation_tasks SET cancel_requested_at = now() WHERE id = $1`, [expiredCancelId])
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    service = createPostgresGenerationTaskExecutionService(pool)
    const recoveries = await Promise.all([
      service.recoverExpiredLeases({ batchSize: 10, retryBaseMs: 100, retryMaxMs: 1_000 }),
      service.recoverExpiredLeases({ batchSize: 10, retryBaseMs: 100, retryMaxMs: 1_000 }),
    ])
    assert.deepEqual(recoveries.reduce((total, result) => ({
      recovered: total.recovered + result.recovered,
      requeued: total.requeued + result.requeued,
      failed: total.failed + result.failed,
      canceled: total.canceled + result.canceled,
    }), { recovered: 0, requeued: 0, failed: 0, canceled: 0 }), {
      recovered: 3,
      requeued: 1,
      failed: 1,
      canceled: 1,
    })
    const recoveredStatuses = await pool.query<{ id: string; status: string }>(`
      SELECT id::text, status FROM generation_tasks WHERE id = ANY($1::uuid[]) ORDER BY id
    `, [[expiredRetryId, expiredCancelId, expiredFinalId]])
    assert.deepEqual(new Map(recoveredStatuses.rows.map((row) => [row.id, row.status])), new Map([
      [expiredRetryId, 'queued'],
      [expiredCancelId, 'canceled'],
      [expiredFinalId, 'failed'],
    ]))

    const submittedTaskId = await insertTask(3)
    const submittedLease = (await service.claimTask({ taskId: submittedTaskId, workerId: 'submission-a' }))!
    const firstSubmission = await service.prepareProviderSubmission({
      taskId: submittedTaskId,
      workerId: submittedLease.workerId,
      leaseToken: submittedLease.leaseToken,
      supportsIdempotentSubmission: false,
    })
    assert.deepEqual(firstSubmission, {
      action: 'submit',
      submissionKey: `provider-submission:${submittedTaskId}`,
    })
    assert.deepEqual(await service.recordProviderSubmission({
      taskId: submittedTaskId,
      workerId: submittedLease.workerId,
      leaseToken: submittedLease.leaseToken,
      remoteTaskId: 'provider-task-123',
    }), { recorded: true })
    assert.deepEqual(await service.recordProviderSubmission({
      taskId: submittedTaskId,
      workerId: submittedLease.workerId,
      leaseToken: submittedLease.leaseToken,
      remoteTaskId: 'provider-task-other',
    }), { recorded: false })
    assert.deepEqual(await service.settleFailure({
      taskId: submittedTaskId,
      workerId: submittedLease.workerId,
      leaseToken: submittedLease.leaseToken,
      retryable: true,
      errorCode: 'WORKER_INTERRUPTED',
      errorMessage: 'interrupted after provider accepted submission',
      retryDelayMs: 1,
    }), { settled: true, status: 'queued' })
    await pool.query(`UPDATE generation_tasks SET available_at = now() WHERE id = $1`, [submittedTaskId])
    await pool.query(`UPDATE task_queue_outbox SET available_at = now() WHERE task_id = $1`, [submittedTaskId])
    const pollingLease = (await service.claimTask({ taskId: submittedTaskId, workerId: 'submission-b' }))!
    assert.deepEqual(await service.prepareProviderSubmission({
      taskId: submittedTaskId,
      workerId: pollingLease.workerId,
      leaseToken: pollingLease.leaseToken,
      supportsIdempotentSubmission: false,
    }), {
      action: 'poll',
      submissionKey: `provider-submission:${submittedTaskId}`,
      remoteTaskId: 'provider-task-123',
    })

    const uncertainTaskId = await insertTask(3)
    const uncertainLease = (await service.claimTask({ taskId: uncertainTaskId, workerId: 'uncertain-a' }))!
    await service.prepareProviderSubmission({
      taskId: uncertainTaskId,
      workerId: uncertainLease.workerId,
      leaseToken: uncertainLease.leaseToken,
      supportsIdempotentSubmission: false,
    })
    await service.settleFailure({
      taskId: uncertainTaskId,
      workerId: uncertainLease.workerId,
      leaseToken: uncertainLease.leaseToken,
      retryable: true,
      errorCode: 'WORKER_INTERRUPTED',
      errorMessage: 'interrupted during provider submission',
      retryDelayMs: 1,
    })
    await pool.query(`UPDATE generation_tasks SET available_at = now() WHERE id = $1`, [uncertainTaskId])
    await pool.query(`UPDATE task_queue_outbox SET available_at = now() WHERE task_id = $1`, [uncertainTaskId])
    const uncertainRecoveryLease = (await service.claimTask({ taskId: uncertainTaskId, workerId: 'uncertain-b' }))!
    assert.deepEqual(await service.prepareProviderSubmission({
      taskId: uncertainTaskId,
      workerId: uncertainRecoveryLease.workerId,
      leaseToken: uncertainRecoveryLease.leaseToken,
      supportsIdempotentSubmission: false,
    }), {
      action: 'uncertain',
      submissionKey: `provider-submission:${uncertainTaskId}`,
    })

    const idempotentTaskId = await insertTask(3)
    const idempotentLease = (await service.claimTask({ taskId: idempotentTaskId, workerId: 'idempotent-a' }))!
    await service.prepareProviderSubmission({
      taskId: idempotentTaskId,
      workerId: idempotentLease.workerId,
      leaseToken: idempotentLease.leaseToken,
      supportsIdempotentSubmission: true,
    })
    await service.settleFailure({
      taskId: idempotentTaskId,
      workerId: idempotentLease.workerId,
      leaseToken: idempotentLease.leaseToken,
      retryable: true,
      errorCode: 'WORKER_INTERRUPTED',
      errorMessage: 'interrupted during idempotent provider submission',
      retryDelayMs: 1,
    })
    await pool.query(`UPDATE generation_tasks SET available_at = now() WHERE id = $1`, [idempotentTaskId])
    await pool.query(`UPDATE task_queue_outbox SET available_at = now() WHERE task_id = $1`, [idempotentTaskId])
    const idempotentRecoveryLease = (await service.claimTask({ taskId: idempotentTaskId, workerId: 'idempotent-b' }))!
    assert.deepEqual(await service.prepareProviderSubmission({
      taskId: idempotentTaskId,
      workerId: idempotentRecoveryLease.workerId,
      leaseToken: idempotentRecoveryLease.leaseToken,
      supportsIdempotentSubmission: true,
    }), {
      action: 'submit',
      submissionKey: `provider-submission:${idempotentTaskId}`,
    })

    const successTaskId = await insertTask(3, 'preview')
    const successLease = (await service.claimTask({ taskId: successTaskId, workerId: 'result-a' }))!
    const resultAssetId = randomUUID()
    const success = await service.settleSuccess({
      taskId: successTaskId,
      workerId: successLease.workerId,
      leaseToken: successLease.leaseToken,
      resultAssets: [{
        assetId: resultAssetId,
        objectKey: `workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/generated/task-results/${successTaskId}/0.png`,
        originalFileName: 'result.png',
        mimeType: 'image/png',
        byteSize: 8,
        sha256: 'a'.repeat(64),
      }],
      usage: { output_images: 1, total_tokens: 42 },
    })
    assert.equal(success.settled, true)
    assert.equal(success.status, 'succeeded')
    assert.equal(success.assetIds[0], resultAssetId)
    assert.equal(success.projectVersion, 1)
    const settled = await pool.query<{
      status: string
      progress: number
      attempt_status: string
      usage_json: Record<string, number>
      result_json: { assetIds: string[] }
      data_json: { userNote: string; generationResults: Record<string, { assets: Array<{ assetId: string }> }> }
      position_x: number
      position_y: number
      ledger_count: number
      reference_count: number
      change_count: number
    }>(`
      SELECT task.status, task.progress, attempt.status AS attempt_status, attempt.usage_json, task.result_json,
             node.data_json, node.position_x, node.position_y,
             (SELECT count(*)::integer FROM usage_ledger WHERE task_id = task.id) AS ledger_count,
             (SELECT count(*)::integer FROM asset_references WHERE task_id = task.id AND reference_role = 'result') AS reference_count,
             (SELECT count(*)::integer FROM project_changes WHERE project_id = task.project_id AND source = 'worker') AS change_count
      FROM generation_tasks task
      JOIN task_attempts attempt ON attempt.task_id = task.id AND attempt.attempt_number = task.attempt_count
      JOIN project_nodes node ON node.project_id = task.project_id AND node.node_id = 'preview'
      WHERE task.id = $1
    `, [successTaskId])
    assert.equal(settled.rows[0]?.status, 'succeeded')
    assert.equal(settled.rows[0]?.progress, 100)
    assert.equal(settled.rows[0]?.attempt_status, 'succeeded')
    assert.deepEqual(settled.rows[0]?.usage_json, { output_images: 1, total_tokens: 42 })
    assert.deepEqual(settled.rows[0]?.result_json.assetIds, [resultAssetId])
    assert.equal(settled.rows[0]?.data_json.userNote, 'preserve')
    assert.deepEqual(settled.rows[0]?.data_json.generationResults[successTaskId]?.assets, [{
      assetId: resultAssetId,
      assetKind: 'generated',
    }])
    assert.equal(settled.rows[0]?.position_x, 42)
    assert.equal(settled.rows[0]?.position_y, 84)
    assert.equal(settled.rows[0]?.ledger_count, 1)
    assert.equal(settled.rows[0]?.reference_count, 1)
    assert.equal(settled.rows[0]?.change_count, 1)
    assert.deepEqual(extractNodeAssetReferences({
      nodeType: 'generatedPreviewNode',
      data: settled.rows[0]!.data_json,
    }), [{ assetId: resultAssetId, referenceRole: 'result' }])
    const replay = await service.settleSuccess({
      taskId: successTaskId,
      workerId: 'stale-worker',
      leaseToken: randomUUID(),
      resultAssets: [{
        assetId: randomUUID(), objectKey: 'ignored/replay.png', originalFileName: 'ignored.png',
        mimeType: 'image/png', byteSize: 8, sha256: 'b'.repeat(64),
      }],
      usage: {},
    })
    assert.deepEqual(replay.assetIds, [resultAssetId])
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM usage_ledger WHERE task_id = $1`, [successTaskId])).rows[0]?.count, 1)
  } finally {
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
