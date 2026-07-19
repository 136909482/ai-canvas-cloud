import type { DbClient, DbPool } from '../../db/postgres.js'
import { withTransaction } from '../../db/postgres.js'

export const TASK_QUEUE_OUTBOX_DEFAULT_BATCH_SIZE = 25
export const TASK_QUEUE_OUTBOX_MAX_BATCH_SIZE = 100
export const TASK_QUEUE_OUTBOX_DEFAULT_CLAIM_TTL_MS = 30_000
export const TASK_QUEUE_OUTBOX_DEFAULT_RETRY_BASE_MS = 1_000
export const TASK_QUEUE_OUTBOX_DEFAULT_RETRY_MAX_MS = 60_000

const ERROR_MESSAGE_MAX_LENGTH = 1000

interface TaskQueueOutboxRow {
  id: string
  task_id: string
  publish_attempt_count: number
  claim_token: string
}

export interface TaskQueueDispatchJob {
  outboxId: string
  taskId: string
}

export interface TaskQueuePublisher {
  publish: (job: TaskQueueDispatchJob) => Promise<void>
}

export interface TaskQueueDispatchResult {
  claimed: number
  published: number
  failed: number
}

export interface TaskQueueOutboxDispatcher {
  dispatchOnce: () => Promise<TaskQueueDispatchResult>
}

export interface TaskQueueOutboxDispatcherOptions {
  owner: string
  publisher: TaskQueuePublisher
  batchSize?: number
  claimTtlMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
}

export async function insertTaskQueueDispatch(
  client: Pick<DbClient, 'query'>,
  input: { workspaceId: string; taskId: string; attemptNumber: number; delayMs?: number },
) {
  const dispatchKey = `run:${input.taskId}:${input.attemptNumber}`
  const delayMs = input.delayMs ?? 0
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('Task queue dispatch delay must be a non-negative integer')
  }
  await client.query(
    `INSERT INTO task_queue_outbox (
       workspace_id, task_id, dispatch_kind, dispatch_key, available_at
     ) VALUES ($1, $2, 'run', $3, now() + ($4::integer * interval '1 millisecond'))
     ON CONFLICT (workspace_id, dispatch_key) DO NOTHING`,
    [input.workspaceId, input.taskId, dispatchKey, delayMs],
  )
}

export function calculateTaskQueueRetryDelay(
  attemptCount: number,
  baseMs = TASK_QUEUE_OUTBOX_DEFAULT_RETRY_BASE_MS,
  maxMs = TASK_QUEUE_OUTBOX_DEFAULT_RETRY_MAX_MS,
) {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1))
  return Math.min(maxMs, baseMs * (2 ** exponent))
}

function validatePositiveInteger(value: number, field: string, maximum?: number) {
  if (!Number.isInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new Error(`${field} must be a positive integer${maximum === undefined ? '' : ` up to ${maximum}`}`)
  }
  return value
}

function sanitizePublishError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = (message.trim() || 'Task queue publish failed')
    .replace(/(rediss?:\/\/)[^\s@/]+@/gi, '$1[redacted]@')
    .replace(/\b(password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  return normalized.slice(0, ERROR_MESSAGE_MAX_LENGTH)
}

export function createPostgresTaskQueueOutboxDispatcher(
  pool: DbPool,
  options: TaskQueueOutboxDispatcherOptions,
): TaskQueueOutboxDispatcher {
  const owner = options.owner.trim()
  if (!owner || owner.length > 160) {
    throw new Error('Task queue dispatcher owner must be between 1 and 160 characters')
  }
  const batchSize = validatePositiveInteger(
    options.batchSize ?? TASK_QUEUE_OUTBOX_DEFAULT_BATCH_SIZE,
    'Task queue outbox batch size',
    TASK_QUEUE_OUTBOX_MAX_BATCH_SIZE,
  )
  const claimTtlMs = validatePositiveInteger(
    options.claimTtlMs ?? TASK_QUEUE_OUTBOX_DEFAULT_CLAIM_TTL_MS,
    'Task queue outbox claim TTL',
  )
  const retryBaseMs = validatePositiveInteger(
    options.retryBaseMs ?? TASK_QUEUE_OUTBOX_DEFAULT_RETRY_BASE_MS,
    'Task queue outbox retry base',
  )
  const retryMaxMs = validatePositiveInteger(
    options.retryMaxMs ?? TASK_QUEUE_OUTBOX_DEFAULT_RETRY_MAX_MS,
    'Task queue outbox retry maximum',
  )
  if (retryBaseMs > retryMaxMs) {
    throw new Error('Task queue outbox retry base must not exceed retry maximum')
  }

  async function claimBatch() {
    return withTransaction(pool, async (client) => {
      const result = await client.query<TaskQueueOutboxRow>(
        `WITH pending AS (
           SELECT id
           FROM task_queue_outbox
           WHERE published_at IS NULL
             AND available_at <= now()
             AND (claim_expires_at IS NULL OR claim_expires_at <= now())
           ORDER BY available_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE task_queue_outbox outbox
         SET claim_owner = $2,
             claim_token = gen_random_uuid(),
             claim_expires_at = now() + ($3::integer * interval '1 millisecond'),
             publish_attempt_count = publish_attempt_count + 1,
             updated_at = now()
         FROM pending
         WHERE outbox.id = pending.id
         RETURNING outbox.id::text, outbox.task_id::text,
                   outbox.publish_attempt_count, outbox.claim_token::text`,
        [batchSize, owner, claimTtlMs],
      )
      return result.rows
    })
  }

  async function markPublished(row: TaskQueueOutboxRow) {
    await pool.query(
      `UPDATE task_queue_outbox
       SET published_at = now(), claim_owner = NULL, claim_token = NULL,
           claim_expires_at = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND published_at IS NULL`,
      [row.id, row.claim_token],
    )
  }

  async function releaseFailed(row: TaskQueueOutboxRow, error: unknown) {
    const retryDelayMs = calculateTaskQueueRetryDelay(row.publish_attempt_count, retryBaseMs, retryMaxMs)
    await pool.query(
      `UPDATE task_queue_outbox
       SET available_at = now() + ($3::integer * interval '1 millisecond'),
           claim_owner = NULL, claim_token = NULL, claim_expires_at = NULL,
           last_error = $4, updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND published_at IS NULL`,
      [row.id, row.claim_token, retryDelayMs, sanitizePublishError(error)],
    )
  }

  return {
    async dispatchOnce() {
      const rows = await claimBatch()
      let published = 0
      let failed = 0

      for (const row of rows) {
        try {
          await options.publisher.publish({ outboxId: row.id, taskId: row.task_id })
          await markPublished(row)
          published += 1
        } catch (error) {
          await releaseFailed(row, error)
          failed += 1
        }
      }

      return { claimed: rows.length, published, failed }
    },
  }
}
