import { randomUUID } from 'node:crypto'
import type { GenerationTaskStatus, ProjectGraphNode, ProjectGraphOperation } from '@ai-canvas-cloud/contracts'
import type { MetricsRegistry } from '@ai-canvas-cloud/shared'
import { withTransaction, type DbClient, type DbPool } from '../../db/postgres.js'
import {
  assertWorkspaceStorageCapacity,
  lockWorkspaceStorageQuota,
  readWorkspaceStorageUsage,
} from '../workspaces/usage.js'
import { insertTaskQueueDispatch } from './queueOutbox.js'
import { normalizeGenerationTaskProgress } from './stateMachine.js'

export const TASK_EXECUTION_DEFAULT_LEASE_TTL_MS = 30_000
export const TASK_EXECUTION_DEFAULT_RETRY_BASE_MS = 5_000
export const TASK_EXECUTION_DEFAULT_RETRY_MAX_MS = 5 * 60_000
export const TASK_EXECUTION_DEFAULT_RECOVERY_BATCH_SIZE = 25
export const TASK_EXECUTION_MAX_RECOVERY_BATCH_SIZE = 100

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,120}$/
const ERROR_MESSAGE_MAX_LENGTH = 1000
const RESULT_OBJECT_KEY_MAX_LENGTH = 512
const RESULT_FILE_NAME_MAX_LENGTH = 255
const RESULT_MIME_TYPE_MAX_LENGTH = 120
const RESULT_ASSET_MAX_COUNT = 16
const RESULT_USAGE_MAX_KEYS = 32
const RESULT_USAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RESULT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

interface ExecutionTaskRow {
  id: string
  workspace_id: string
  project_id: string
  created_by_user_id: string
  source_node_id: string
  preview_node_id: string | null
  task_kind: 'image' | 'video'
  provider_id: string
  model_key: string
  billing_mode: 'workspace_key' | 'platform'
  queue_lane: string
  request_json: Record<string, unknown>
  status: GenerationTaskStatus
  progress: number
  attempt_count: number
  max_attempts: number
  remote_task_id: string | null
  lease_owner: string | null
  lease_token: string | null
  lease_expires_at: Date | string | null
  cancel_requested_at: Date | string | null
}

export interface GenerationTaskLease {
  taskId: string
  workspaceId: string
  projectId: string
  sourceNodeId: string
  previewNodeId: string | null
  kind: 'image' | 'video'
  providerId: string
  model: string
  billingMode: 'workspace_key' | 'platform'
  queueLane: string
  parameters: Record<string, unknown>
  attemptNumber: number
  maxAttempts: number
  workerId: string
  leaseToken: string
  leaseExpiresAt: string
}

export interface GenerationTaskLeaseState {
  renewed: boolean
  cancelRequested: boolean
  leaseExpiresAt: string | null
}

export interface GenerationTaskSettlement {
  settled: boolean
  status: 'queued' | 'failed' | 'canceled' | null
}

export interface TaskResultAsset {
  assetId: string
  objectKey: string
  originalFileName: string | null
  mimeType: string
  byteSize: number
  sha256: string
  width?: number | null
  height?: number | null
}

export interface GenerationTaskSuccessSettlement {
  settled: boolean
  status: 'succeeded' | 'canceled' | null
  assetIds: string[]
  projectVersion: number | null
  projectSequence: number | null
}

export interface GenerationTaskRecoveryResult {
  recovered: number
  requeued: number
  failed: number
  canceled: number
}

export type ProviderSubmissionStage = 'ready' | 'submitting' | 'submitted' | 'polling' | 'uncertain'

export type ProviderSubmissionDecision =
  | { action: 'submit'; submissionKey: string }
  | { action: 'poll'; submissionKey: string; remoteTaskId: string }
  | { action: 'uncertain'; submissionKey: string }

export interface GenerationTaskExecutionService {
  claimTask: (input: {
    taskId: string
    workerId: string
    leaseTtlMs?: number
  }) => Promise<GenerationTaskLease | null>
  renewLease: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    leaseTtlMs?: number
  }) => Promise<GenerationTaskLeaseState>
  updateProgress: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    progress: number
    leaseTtlMs?: number
  }) => Promise<GenerationTaskLeaseState>
  settleCanceled: (input: {
    taskId: string
    workerId: string
    leaseToken: string
  }) => Promise<GenerationTaskSettlement>
  settleFailure: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    retryable: boolean
    errorCode: string
    errorMessage: string
    retryDelayMs?: number
  }) => Promise<GenerationTaskSettlement>
  settleSuccess: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    resultAssets: TaskResultAsset[]
    usage: Record<string, number>
  }) => Promise<GenerationTaskSuccessSettlement>
  getSourceAsset: (input: {
    taskId: string
    workerId: string
    leaseToken: string
  }) => Promise<{ objectKey: string; mimeType: string } | null>
  prepareProviderSubmission: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    supportsIdempotentSubmission: boolean
  }) => Promise<ProviderSubmissionDecision | null>
  recordProviderSubmission: (input: {
    taskId: string
    workerId: string
    leaseToken: string
    remoteTaskId: string
  }) => Promise<{ recorded: boolean }>
  recoverExpiredLeases: (input?: {
    batchSize?: number
    retryBaseMs?: number
    retryMaxMs?: number
  }) => Promise<GenerationTaskRecoveryResult>
}

function requirePositiveInteger(value: number, field: string, maximum?: number) {
  if (!Number.isInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new Error(`${field} must be a positive integer${maximum === undefined ? '' : ` up to ${maximum}`}`)
  }
  return value
}

function requireUuid(value: string, field: string) {
  const normalized = value.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a valid UUID`)
  }
  return normalized
}

function requireWorkerId(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160) {
    throw new Error('workerId must be between 1 and 160 characters')
  }
  return normalized
}

function requireErrorCode(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!ERROR_CODE_PATTERN.test(normalized)) {
    throw new Error('errorCode must contain only A-Z, 0-9, and underscore')
  }
  return normalized
}

function requireRemoteTaskId(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 512) {
    throw new Error('remoteTaskId must be between 1 and 512 characters')
  }
  return normalized
}

function requireResultAsset(input: TaskResultAsset, index: number): TaskResultAsset {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`resultAssets[${index}] must be an object`)
  }
  const assetId = requireUuid(input.assetId, `resultAssets[${index}].assetId`)
  const objectKey = input.objectKey?.trim()
  if (!objectKey || objectKey.length > RESULT_OBJECT_KEY_MAX_LENGTH || /\s|(^|\/)\.\.?($|\/)/.test(objectKey)) {
    throw new Error(`resultAssets[${index}].objectKey is invalid`)
  }
  const originalFileName = input.originalFileName === null ? null : input.originalFileName?.trim()
  if (originalFileName !== null && (!originalFileName || originalFileName.length > RESULT_FILE_NAME_MAX_LENGTH)) {
    throw new Error(`resultAssets[${index}].originalFileName is invalid`)
  }
  const mimeType = input.mimeType?.trim().toLowerCase()
  if (!mimeType || mimeType.length > RESULT_MIME_TYPE_MAX_LENGTH || !RESULT_MIME_TYPES.has(mimeType)) {
    throw new Error(`resultAssets[${index}].mimeType is not supported`)
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
    throw new Error(`resultAssets[${index}].byteSize must be a positive safe integer`)
  }
  const sha256 = input.sha256?.trim().toLowerCase()
  if (!sha256 || !SHA256_PATTERN.test(sha256)) {
    throw new Error(`resultAssets[${index}].sha256 must be a SHA-256 hex digest`)
  }
  for (const [field, value] of [['width', input.width], ['height', input.height]] as const) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`resultAssets[${index}].${field} must be a positive safe integer when present`)
    }
  }
  return { assetId, objectKey, originalFileName, mimeType, byteSize: input.byteSize, sha256, width: input.width ?? null, height: input.height ?? null }
}

function requireResultAssets(value: TaskResultAsset[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > RESULT_ASSET_MAX_COUNT) {
    throw new Error(`resultAssets must contain between 1 and ${RESULT_ASSET_MAX_COUNT} assets`)
  }
  const assets = value.map(requireResultAsset)
  const ids = new Set(assets.map((asset) => asset.assetId))
  const objectKeys = new Set(assets.map((asset) => asset.objectKey))
  if (ids.size !== assets.length || objectKeys.size !== assets.length) {
    throw new Error('resultAssets must not contain duplicate asset IDs or object keys')
  }
  return assets
}

function requireUsage(value: Record<string, number>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('usage must be an object')
  }
  const entries = Object.entries(value)
  if (entries.length > RESULT_USAGE_MAX_KEYS) {
    throw new Error(`usage must contain at most ${RESULT_USAGE_MAX_KEYS} entries`)
  }
  for (const [key, amount] of entries) {
    if (!RESULT_USAGE_KEY_PATTERN.test(key) || !Number.isFinite(amount) || amount < 0) {
      throw new Error('usage must contain non-negative finite numeric counters')
    }
  }
  return Object.fromEntries(entries)
}

function sanitizeErrorMessage(value: string) {
  const normalized = value.trim()
    .replace(/(https?:\/\/)[^\s@/]+@/gi, '$1[redacted]@')
    .replace(/\b(password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  return (normalized || 'Task execution failed').slice(0, ERROR_MESSAGE_MAX_LENGTH)
}

export function calculateTaskExecutionRetryDelay(
  attemptCount: number,
  baseMs = TASK_EXECUTION_DEFAULT_RETRY_BASE_MS,
  maxMs = TASK_EXECUTION_DEFAULT_RETRY_MAX_MS,
) {
  requirePositiveInteger(attemptCount, 'attemptCount')
  requirePositiveInteger(baseMs, 'retryBaseMs')
  requirePositiveInteger(maxMs, 'retryMaxMs')
  if (baseMs > maxMs) {
    throw new Error('retryBaseMs must not exceed retryMaxMs')
  }
  return Math.min(maxMs, baseMs * (2 ** Math.min(20, attemptCount - 1)))
}

function taskColumns(alias = 'generation_tasks') {
  return `
    ${alias}.id::text, ${alias}.workspace_id::text, ${alias}.project_id::text,
    ${alias}.created_by_user_id,
    ${alias}.source_node_id, ${alias}.preview_node_id, ${alias}.task_kind,
    ${alias}.provider_id, ${alias}.model_key, ${alias}.billing_mode,
    ${alias}.queue_lane, ${alias}.request_json, ${alias}.status,
    ${alias}.progress, ${alias}.attempt_count, ${alias}.max_attempts, ${alias}.remote_task_id,
    ${alias}.lease_owner, ${alias}.lease_token::text, ${alias}.lease_expires_at,
    ${alias}.cancel_requested_at
  `
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

async function finishAttempt(
  client: DbClient,
  task: ExecutionTaskRow,
  input: {
    status: 'succeeded' | 'failed' | 'canceled'
    retryable: boolean
    errorCode: string | null
    errorMessage: string | null
  },
) {
  const result = await client.query(
    `UPDATE task_attempts
     SET status = $3, retryable = $4, error_code = $5,
         error_message = $6, finished_at = now()
     WHERE workspace_id = $1 AND task_id = $2
       AND attempt_number = $7 AND status = 'running'`,
    [
      task.workspace_id,
      task.id,
      input.status,
      input.retryable,
      input.errorCode,
      input.errorMessage,
      task.attempt_count,
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error('Running task attempt is missing or already settled')
  }
}

interface ResultNodeRow {
  node_id: string
  node_type: string
  position_x: number
  position_y: number
  width: number | null
  height: number | null
  z_index: number
  parent_node_id: string | null
  data_schema_version: number
  data_json: Record<string, unknown>
  presentation_json: Record<string, unknown>
}

interface LockedResultProjectRow {
  version: string | number
  last_sequence: string | number
}

function toProjectGraphNode(row: ResultNodeRow): ProjectGraphNode {
  return {
    id: row.node_id,
    nodeType: row.node_type,
    position: { x: row.position_x, y: row.position_y },
    ...(row.width === null || row.height === null ? {} : { size: { width: row.width, height: row.height } }),
    ...(row.z_index === 0 ? {} : { zIndex: row.z_index }),
    ...(row.parent_node_id === null ? {} : { parentNodeId: row.parent_node_id }),
    dataSchemaVersion: row.data_schema_version,
    data: row.data_json,
    ...(Object.keys(row.presentation_json).length === 0 ? {} : { presentation: row.presentation_json }),
  }
}

async function readSucceededResultAssetIds(client: Pick<DbClient, 'query'>, task: ExecutionTaskRow) {
  const result = await client.query<{ asset_id: string }>(
    `SELECT asset_id::text
     FROM asset_references
     WHERE workspace_id = $1 AND project_id = $2 AND task_id = $3 AND reference_role = 'result'
     ORDER BY asset_id`,
    [task.workspace_id, task.project_id, task.id],
  )
  return result.rows.map((row) => row.asset_id)
}

async function insertTaskResultAssets(
  client: DbClient,
  task: ExecutionTaskRow,
  assets: TaskResultAsset[],
) {
  for (const asset of assets) {
    const assetKind = task.task_kind === 'video' ? 'video' : 'generated'
    await client.query(
      `INSERT INTO assets (
         id, workspace_id, origin_project_id, created_by_user_id, object_key,
         original_file_name, mime_type, byte_size, sha256, width, height, asset_kind, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'completed')
       ON CONFLICT (id) DO NOTHING`,
      [
        asset.assetId, task.workspace_id, task.project_id, task.created_by_user_id,
        asset.objectKey, asset.originalFileName, asset.mimeType, asset.byteSize, asset.sha256,
        asset.width ?? null, asset.height ?? null, assetKind,
      ],
    )
    const existing = await client.query<{
      workspace_id: string
      origin_project_id: string | null
      object_key: string
      mime_type: string
      byte_size: string | number
      sha256: string | null
      status: string
    }>(
      `SELECT workspace_id::text, origin_project_id::text, object_key, mime_type, byte_size, sha256, status
       FROM assets WHERE id = $1 FOR SHARE`,
      [asset.assetId],
    )
    const row = existing.rows[0]
    if (!row || row.workspace_id !== task.workspace_id || row.origin_project_id !== task.project_id
      || row.object_key !== asset.objectKey || row.mime_type !== asset.mimeType
      || Number(row.byte_size) !== asset.byteSize || row.sha256 !== asset.sha256 || row.status !== 'completed') {
      throw new Error('Task result asset ID is already associated with different metadata')
    }
  }
}

async function insertTaskResultReferences(
  client: DbClient,
  task: ExecutionTaskRow,
  assetIds: string[],
  previewNodeId: string | null,
) {
  for (const assetId of assetIds) {
    await client.query(
      `INSERT INTO asset_references (workspace_id, asset_id, project_id, task_id, reference_role)
       VALUES ($1, $2, $3, $4, 'result')
       ON CONFLICT DO NOTHING`,
      [task.workspace_id, assetId, task.project_id, task.id],
    )
    if (previewNodeId) {
      await client.query(
        `INSERT INTO asset_references (workspace_id, asset_id, project_id, node_id, reference_role)
         VALUES ($1, $2, $3, $4, 'result')
         ON CONFLICT DO NOTHING`,
        [task.workspace_id, assetId, task.project_id, previewNodeId],
      )
    }
  }
}

async function updateResultPreviewNode(
  client: DbClient,
  task: ExecutionTaskRow,
  resultAssets: TaskResultAsset[],
) {
  if (!task.preview_node_id) {
    return null
  }
  const result = await client.query<ResultNodeRow>(
    `UPDATE project_nodes
     SET data_json = jsonb_set(
           data_json,
           '{generationResults}',
           COALESCE(data_json->'generationResults', '{}'::jsonb)
             || jsonb_build_object($3::text, jsonb_build_object('assets', $4::jsonb, 'taskId', $3::text)),
           true
         ),
         row_version = row_version + 1,
         updated_at = now()
     WHERE project_id = $1 AND node_id = $2 AND deleted_at IS NULL
     RETURNING node_id, node_type, position_x, position_y, width, height, z_index, parent_node_id,
               data_schema_version, data_json, presentation_json`,
    [
      task.project_id,
      task.preview_node_id,
      task.id,
      JSON.stringify(resultAssets.map((asset) => ({
        assetId: asset.assetId,
        assetKind: task.task_kind === 'video' ? 'video' : 'generated',
      }))),
    ],
  )
  return result.rows[0] ?? null
}

async function readLockedLeaseTask(
  client: DbClient,
  input: { taskId: string; workerId: string; leaseToken: string },
) {
  const result = await client.query<ExecutionTaskRow>(
    `SELECT ${taskColumns('task')}
     FROM generation_tasks task
     WHERE task.id = $1 AND task.status = 'running'
       AND task.lease_owner = $2 AND task.lease_token = $3
     FOR UPDATE`,
    [input.taskId, input.workerId, input.leaseToken],
  )
  return result.rows[0] ?? null
}

interface TaskAttemptSubmissionRow {
  submission_key: string
  submission_stage: ProviderSubmissionStage
  remote_task_id: string | null
}

async function readLockedAttemptSubmission(client: DbClient, task: ExecutionTaskRow) {
  const result = await client.query<TaskAttemptSubmissionRow>(
    `SELECT submission_key, submission_stage, remote_task_id
     FROM task_attempts
     WHERE workspace_id = $1 AND task_id = $2 AND attempt_number = $3
     FOR UPDATE`,
    [task.workspace_id, task.id, task.attempt_count],
  )
  const attempt = result.rows[0]
  if (!attempt) {
    throw new Error('Running task attempt is missing')
  }
  return attempt
}

async function setAttemptSubmissionStage(
  client: DbClient,
  task: ExecutionTaskRow,
  stage: Exclude<ProviderSubmissionStage, 'submitted' | 'polling'>,
) {
  await client.query(
    `UPDATE task_attempts
     SET submission_stage = $4, remote_task_id = NULL
     WHERE workspace_id = $1 AND task_id = $2 AND attempt_number = $3`,
    [task.workspace_id, task.id, task.attempt_count, stage],
  )
}

async function settleLockedCanceled(client: DbClient, task: ExecutionTaskRow) {
  await finishAttempt(client, task, {
    status: 'canceled', retryable: false, errorCode: null, errorMessage: null,
  })
  await client.query(
    `UPDATE generation_tasks
     SET status = 'canceled', cancel_requested_at = COALESCE(cancel_requested_at, now()),
         lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
         finished_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running' AND lease_token = $2`,
    [task.id, task.lease_token],
  )
}

async function settleLockedFailure(
  client: DbClient,
  task: ExecutionTaskRow,
  input: {
    retryable: boolean
    errorCode: string
    errorMessage: string
    retryDelayMs: number
  },
  metrics?: MetricsRegistry,
) {
  if (task.cancel_requested_at) {
    await settleLockedCanceled(client, task)
    return 'canceled' as const
  }

  await finishAttempt(client, task, {
    status: 'failed',
    retryable: input.retryable,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  })

  if (input.retryable && task.attempt_count < task.max_attempts) {
    await client.query(
      `UPDATE generation_tasks
       SET status = 'queued', progress = 0,
           available_at = now() + ($3::integer * interval '1 millisecond'),
           error_code = $4, error_message = $5, cancel_requested_at = NULL,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           finished_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'running' AND lease_token = $2`,
      [task.id, task.lease_token, input.retryDelayMs, input.errorCode, input.errorMessage],
    )
    await insertTaskQueueDispatch(client, {
      workspaceId: task.workspace_id,
      taskId: task.id,
      attemptNumber: task.attempt_count + 1,
      delayMs: input.retryDelayMs,
    })
    metrics?.increment('task_retries_total', 1, { outcome: 'requeued' })
    return 'queued' as const
  }

  await client.query(
    `UPDATE generation_tasks
     SET status = 'failed', error_code = $3, error_message = $4,
         cancel_requested_at = NULL, lease_owner = NULL, lease_token = NULL,
         lease_expires_at = NULL, finished_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running' AND lease_token = $2`,
    [task.id, task.lease_token, input.errorCode, input.errorMessage],
  )
  return 'failed' as const
}

export function createPostgresGenerationTaskExecutionService(
  pool: DbPool,
  options: { metrics?: MetricsRegistry } = {},
): GenerationTaskExecutionService {
  const metrics = options.metrics
  return {
    async claimTask(input) {
      const taskId = requireUuid(input.taskId, 'taskId')
      const workerId = requireWorkerId(input.workerId)
      const leaseTtlMs = requirePositiveInteger(
        input.leaseTtlMs ?? TASK_EXECUTION_DEFAULT_LEASE_TTL_MS,
        'leaseTtlMs',
      )
      return withTransaction(pool, async (client) => {
        const leaseToken = randomUUID()
        const result = await client.query<ExecutionTaskRow>(
          `UPDATE generation_tasks
           SET status = 'running', progress = 0,
               attempt_count = attempt_count + 1,
               lease_owner = $2, lease_token = $3,
               lease_expires_at = now() + ($4::integer * interval '1 millisecond'),
               started_at = COALESCE(started_at, now()),
               error_code = NULL, error_message = NULL, finished_at = NULL,
               updated_at = now()
           WHERE id = $1 AND status = 'queued' AND available_at <= now()
             AND attempt_count < max_attempts
           RETURNING ${taskColumns()}`,
          [taskId, workerId, leaseToken, leaseTtlMs],
        )
        const task = result.rows[0]
        if (!task) {
          return null
        }
        await client.query(
          `INSERT INTO task_attempts (
             workspace_id, task_id, attempt_number, provider_id, model_key, submission_key
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            task.workspace_id,
            task.id,
            task.attempt_count,
            task.provider_id,
            task.model_key,
            `provider-submission:${task.id}`,
          ],
        )
        return {
          taskId: task.id,
          workspaceId: task.workspace_id,
          projectId: task.project_id,
          sourceNodeId: task.source_node_id,
          previewNodeId: task.preview_node_id,
          kind: task.task_kind,
          providerId: task.provider_id,
          model: task.model_key,
          billingMode: task.billing_mode,
          queueLane: task.queue_lane,
          parameters: task.request_json,
          attemptNumber: task.attempt_count,
          maxAttempts: task.max_attempts,
          workerId,
          leaseToken,
          leaseExpiresAt: toIso(task.lease_expires_at!),
        }
      })
    },

    async renewLease(input) {
      const taskId = requireUuid(input.taskId, 'taskId')
      const workerId = requireWorkerId(input.workerId)
      const leaseToken = requireUuid(input.leaseToken, 'leaseToken')
      const leaseTtlMs = requirePositiveInteger(
        input.leaseTtlMs ?? TASK_EXECUTION_DEFAULT_LEASE_TTL_MS,
        'leaseTtlMs',
      )
      const result = await pool.query<Pick<ExecutionTaskRow, 'cancel_requested_at' | 'lease_expires_at'>>(
        `UPDATE generation_tasks
         SET lease_expires_at = now() + ($4::integer * interval '1 millisecond'),
             updated_at = now()
         WHERE id = $1 AND status = 'running' AND lease_owner = $2
           AND lease_token = $3 AND lease_expires_at > now()
         RETURNING cancel_requested_at, lease_expires_at`,
        [taskId, workerId, leaseToken, leaseTtlMs],
      )
      const row = result.rows[0]
      return {
        renewed: Boolean(row),
        cancelRequested: Boolean(row?.cancel_requested_at),
        leaseExpiresAt: row?.lease_expires_at ? toIso(row.lease_expires_at) : null,
      }
    },

    async updateProgress(input) {
      const taskId = requireUuid(input.taskId, 'taskId')
      const workerId = requireWorkerId(input.workerId)
      const leaseToken = requireUuid(input.leaseToken, 'leaseToken')
      const progress = normalizeGenerationTaskProgress(input.progress)
      const leaseTtlMs = requirePositiveInteger(
        input.leaseTtlMs ?? TASK_EXECUTION_DEFAULT_LEASE_TTL_MS,
        'leaseTtlMs',
      )
      const result = await pool.query<Pick<ExecutionTaskRow, 'cancel_requested_at' | 'lease_expires_at'>>(
        `UPDATE generation_tasks
         SET progress = GREATEST(progress, $4),
             lease_expires_at = now() + ($5::integer * interval '1 millisecond'),
             updated_at = now()
         WHERE id = $1 AND status = 'running' AND lease_owner = $2
           AND lease_token = $3 AND lease_expires_at > now()
         RETURNING cancel_requested_at, lease_expires_at`,
        [taskId, workerId, leaseToken, progress, leaseTtlMs],
      )
      const row = result.rows[0]
      return {
        renewed: Boolean(row),
        cancelRequested: Boolean(row?.cancel_requested_at),
        leaseExpiresAt: row?.lease_expires_at ? toIso(row.lease_expires_at) : null,
      }
    },

    async settleCanceled(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
      }
      return withTransaction(pool, async (client) => {
        const task = await readLockedLeaseTask(client, normalized)
        if (!task) {
          return { settled: false, status: null }
        }
        await settleLockedCanceled(client, task)
        return { settled: true, status: 'canceled' }
      })
    },

    async settleFailure(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
        retryable: input.retryable,
        errorCode: requireErrorCode(input.errorCode),
        errorMessage: sanitizeErrorMessage(input.errorMessage),
        retryDelayMs: requirePositiveInteger(
          input.retryDelayMs ?? TASK_EXECUTION_DEFAULT_RETRY_BASE_MS,
          'retryDelayMs',
        ),
      }
      return withTransaction(pool, async (client) => {
        const task = await readLockedLeaseTask(client, normalized)
        if (!task) {
          return { settled: false, status: null }
        }
        const status = await settleLockedFailure(client, task, normalized, metrics)
        return { settled: true, status }
      })
    },

    async settleSuccess(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
        resultAssets: requireResultAssets(input.resultAssets),
        usage: requireUsage(input.usage),
      }
      return withTransaction(pool, async (client) => {
        const taskResult = await client.query<ExecutionTaskRow>(
          `SELECT ${taskColumns('task')} FROM generation_tasks task WHERE task.id = $1 FOR UPDATE`,
          [normalized.taskId],
        )
        const task = taskResult.rows[0]
        if (!task) {
          return { settled: false, status: null, assetIds: [], projectVersion: null, projectSequence: null }
        }
        if (task.status === 'succeeded') {
          return {
            settled: true,
            status: 'succeeded',
            assetIds: await readSucceededResultAssetIds(client, task),
            projectVersion: null,
            projectSequence: null,
          }
        }
        if (task.status !== 'running' || task.lease_owner !== normalized.workerId || task.lease_token !== normalized.leaseToken) {
          return { settled: false, status: null, assetIds: [], projectVersion: null, projectSequence: null }
        }
        if (task.cancel_requested_at) {
          await settleLockedCanceled(client, task)
          return { settled: true, status: 'canceled', assetIds: [], projectVersion: null, projectSequence: null }
        }

        await lockWorkspaceStorageQuota(client, task.workspace_id)
        const requestedBytes = normalized.resultAssets.reduce((total, asset) => total + asset.byteSize, 0)
        assertWorkspaceStorageCapacity(await readWorkspaceStorageUsage(client, task.workspace_id), requestedBytes)
        await insertTaskResultAssets(client, task, normalized.resultAssets)

        let resultNode: ResultNodeRow | null = null
        let project: LockedResultProjectRow | null = null
        if (task.preview_node_id) {
          const projectResult = await client.query<LockedResultProjectRow>(
            `SELECT version, last_sequence
             FROM projects
             WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
             FOR UPDATE`,
            [task.project_id, task.workspace_id],
          )
          project = projectResult.rows[0] ?? null
          if (project) {
            resultNode = await updateResultPreviewNode(
              client,
              task,
              normalized.resultAssets,
            )
          }
        }
        await insertTaskResultReferences(
          client,
          task,
          normalized.resultAssets.map((asset) => asset.assetId),
          resultNode ? task.preview_node_id : null,
        )
        await client.query(
          `INSERT INTO usage_ledger (
             workspace_id, task_id, attempt_number, provider_id, model_key, billing_mode, usage_json
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (task_id) DO NOTHING`,
          [
            task.workspace_id, task.id, task.attempt_count, task.provider_id,
            task.model_key, task.billing_mode, JSON.stringify(normalized.usage),
          ],
        )
        await finishAttempt(client, task, {
          status: 'succeeded', retryable: false, errorCode: null, errorMessage: null,
        })
        await client.query(
          `UPDATE task_attempts SET usage_json = $4::jsonb
           WHERE workspace_id = $1 AND task_id = $2 AND attempt_number = $3`,
          [task.workspace_id, task.id, task.attempt_count, JSON.stringify(normalized.usage)],
        )

        let projectVersion: number | null = null
        let projectSequence: number | null = null
        if (project && resultNode) {
          const baseVersion = Number(project.version)
          const sequence = Number(project.last_sequence) + 1
          const operation: ProjectGraphOperation = { type: 'upsertNode', node: toProjectGraphNode(resultNode) }
          await client.query(
            `INSERT INTO project_changes (
               project_id, sequence, base_version, result_version, actor_user_id,
               client_id, batch_id, idempotency_key, source, operations_json
             ) VALUES ($1, $2, $3, $4, NULL, NULL, $5, $5, 'worker', $6::jsonb)`,
            [
              task.project_id,
              sequence,
              baseVersion,
              baseVersion + 1,
              `worker-task-result:${task.id}`,
              JSON.stringify([operation]),
            ],
          )
          await client.query(
            `UPDATE projects
             SET version = $3, last_sequence = $4, updated_at = now()
             WHERE id = $1 AND workspace_id = $2 AND version = $5`,
            [task.project_id, task.workspace_id, baseVersion + 1, sequence, baseVersion],
          )
          projectVersion = baseVersion + 1
          projectSequence = sequence
        }
        await client.query(
          `UPDATE generation_tasks
           SET status = 'succeeded', progress = 100,
               result_json = jsonb_build_object('assetIds', $4::jsonb),
               error_code = NULL, error_message = NULL, cancel_requested_at = NULL,
               lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
               finished_at = now(), updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_token = $3`,
          [task.id, task.workspace_id, task.lease_token, JSON.stringify(normalized.resultAssets.map((asset) => asset.assetId))],
        )
        return {
          settled: true,
          status: 'succeeded',
          assetIds: normalized.resultAssets.map((asset) => asset.assetId),
          projectVersion,
          projectSequence,
        }
      })
    },

    async getSourceAsset(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
      }
      return withTransaction(pool, async (client) => {
        const task = await readLockedLeaseTask(client, normalized)
        if (!task) {
          return null
        }
        const result = await client.query<{ object_key: string; mime_type: string }>(
          `SELECT a.object_key, a.mime_type
           FROM asset_references reference
           JOIN assets a ON a.workspace_id = reference.workspace_id AND a.id = reference.asset_id
           WHERE reference.workspace_id = $1 AND reference.project_id = $2
             AND reference.node_id = $3 AND reference.reference_role IN ('source', 'result')
             AND a.deleted_at IS NULL AND a.status = 'completed'
           ORDER BY CASE reference.reference_role WHEN 'source' THEN 0 ELSE 1 END, reference.created_at DESC
           LIMIT 1
           FOR SHARE`,
          [task.workspace_id, task.project_id, task.source_node_id],
        )
        const asset = result.rows[0]
        return asset ? { objectKey: asset.object_key, mimeType: asset.mime_type } : null
      })
    },

    async prepareProviderSubmission(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
      }
      if (typeof input.supportsIdempotentSubmission !== 'boolean') {
        throw new Error('supportsIdempotentSubmission must be a boolean')
      }
      return withTransaction(pool, async (client) => {
        const task = await readLockedLeaseTask(client, normalized)
        if (!task) {
          return null
        }
        const attempt = await readLockedAttemptSubmission(client, task)
        const remoteTaskId = task.remote_task_id ?? attempt.remote_task_id
        if (remoteTaskId) {
          await client.query(
            `UPDATE task_attempts
             SET submission_stage = 'polling', remote_task_id = $4
             WHERE workspace_id = $1 AND task_id = $2 AND attempt_number = $3`,
            [task.workspace_id, task.id, task.attempt_count, remoteTaskId],
          )
          return { action: 'poll', submissionKey: attempt.submission_key, remoteTaskId }
        }

        if (attempt.submission_stage === 'uncertain') {
          return { action: 'uncertain', submissionKey: attempt.submission_key }
        }
        if (attempt.submission_stage === 'submitting' && !input.supportsIdempotentSubmission) {
          await setAttemptSubmissionStage(client, task, 'uncertain')
          return { action: 'uncertain', submissionKey: attempt.submission_key }
        }

        const prior = await client.query<Pick<TaskAttemptSubmissionRow, 'submission_stage'>>(
          `SELECT submission_stage
           FROM task_attempts
           WHERE workspace_id = $1 AND task_id = $2 AND attempt_number < $3
             AND submission_stage IN ('submitting', 'uncertain')
           ORDER BY attempt_number DESC
           LIMIT 1
           FOR UPDATE`,
          [task.workspace_id, task.id, task.attempt_count],
        )
        if (prior.rows[0] && !input.supportsIdempotentSubmission) {
          await setAttemptSubmissionStage(client, task, 'uncertain')
          return { action: 'uncertain', submissionKey: attempt.submission_key }
        }

        await setAttemptSubmissionStage(client, task, 'submitting')
        return { action: 'submit', submissionKey: attempt.submission_key }
      })
    },

    async recordProviderSubmission(input) {
      const normalized = {
        taskId: requireUuid(input.taskId, 'taskId'),
        workerId: requireWorkerId(input.workerId),
        leaseToken: requireUuid(input.leaseToken, 'leaseToken'),
        remoteTaskId: requireRemoteTaskId(input.remoteTaskId),
      }
      return withTransaction(pool, async (client) => {
        const task = await readLockedLeaseTask(client, normalized)
        if (!task) {
          return { recorded: false }
        }
        const attempt = await readLockedAttemptSubmission(client, task)
        if (attempt.submission_stage === 'uncertain') {
          return { recorded: false }
        }
        if (attempt.submission_stage === 'submitted' || attempt.submission_stage === 'polling') {
          return { recorded: attempt.remote_task_id === normalized.remoteTaskId }
        }
        if (attempt.submission_stage !== 'submitting') {
          return { recorded: false }
        }
        await client.query(
          `UPDATE task_attempts
           SET submission_stage = 'submitted', remote_task_id = $4
           WHERE workspace_id = $1 AND task_id = $2 AND attempt_number = $3`,
          [task.workspace_id, task.id, task.attempt_count, normalized.remoteTaskId],
        )
        await client.query(
          `UPDATE generation_tasks
           SET remote_task_id = $4, updated_at = now()
           WHERE id = $1 AND lease_owner = $2 AND lease_token = $3 AND status = 'running'`,
          [task.id, task.lease_owner, task.lease_token, normalized.remoteTaskId],
        )
        return { recorded: true }
      })
    },

    async recoverExpiredLeases(input = {}) {
      const batchSize = requirePositiveInteger(
        input.batchSize ?? TASK_EXECUTION_DEFAULT_RECOVERY_BATCH_SIZE,
        'batchSize',
        TASK_EXECUTION_MAX_RECOVERY_BATCH_SIZE,
      )
      const retryBaseMs = requirePositiveInteger(
        input.retryBaseMs ?? TASK_EXECUTION_DEFAULT_RETRY_BASE_MS,
        'retryBaseMs',
      )
      const retryMaxMs = requirePositiveInteger(
        input.retryMaxMs ?? TASK_EXECUTION_DEFAULT_RETRY_MAX_MS,
        'retryMaxMs',
      )
      if (retryBaseMs > retryMaxMs) {
        throw new Error('retryBaseMs must not exceed retryMaxMs')
      }
      return withTransaction(pool, async (client) => {
        const result = await client.query<ExecutionTaskRow>(
          `SELECT ${taskColumns('task')}
           FROM generation_tasks task
           WHERE task.status = 'running' AND task.lease_expires_at <= now()
           ORDER BY task.lease_expires_at, task.id
           FOR UPDATE SKIP LOCKED
           LIMIT $1`,
          [batchSize],
        )
        let requeued = 0
        let failed = 0
        let canceled = 0

        for (const task of result.rows) {
          metrics?.increment('task_lease_expired_total', 1, {
            outcome: task.cancel_requested_at ? 'canceled' : 'recovered',
          })
          if (task.cancel_requested_at) {
            await settleLockedCanceled(client, task)
            canceled += 1
            continue
          }
          const status = await settleLockedFailure(client, task, {
            retryable: true,
            errorCode: 'WORKER_LEASE_EXPIRED',
            errorMessage: 'Worker lease expired before the attempt completed',
            retryDelayMs: calculateTaskExecutionRetryDelay(task.attempt_count, retryBaseMs, retryMaxMs),
          }, metrics)
          if (status === 'queued') {
            requeued += 1
          } else {
            failed += 1
          }
        }
        return {
          recovered: result.rows.length,
          requeued,
          failed,
          canceled,
        }
      })
    },
  }
}
