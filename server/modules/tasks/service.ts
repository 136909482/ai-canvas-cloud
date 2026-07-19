import type {
  CreateGenerationTaskRequest,
  GenerationTaskEventsResponse,
  GenerationTaskCommandRequest,
  GenerationTaskResponse,
  GenerationTaskStatus,
  GenerationTasksResponse,
  WorkspaceRole,
} from '@ai-canvas-cloud/contracts'
import { Buffer } from 'node:buffer'
import { withTransaction, type DbClient, type DbPool } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import { isProviderGenerationTaskEnabled } from '../providers/registry.js'
import { lockConfiguredProviderCredential } from '../providers/service.js'
import type { ProjectActor } from '../projects/service.js'
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from '../workspaces/authorization.js'
import { insertTaskQueueDispatch } from './queueOutbox.js'

export const GENERATION_TASK_DEFAULT_LIMIT = 50
export const GENERATION_TASK_MAX_LIMIT = 100
export const GENERATION_TASK_ACTIVE_LIMIT = 5
export const GENERATION_TASK_PARAMETERS_MAX_BYTES = 256 * 1024

const TASK_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'editor']
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TASK_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'succeeded', 'failed', 'canceled'])
const FORBIDDEN_PARAMETER_KEYS = new Set([
  'apikey', 'api_key', 'authorization', 'apiurl', 'api_url', 'baseurl', 'base_url',
  'endpoint', 'targeturl', 'target_url',
])

interface GenerationTaskRow {
  id: string
  project_id: string
  source_node_id: string
  preview_node_id: string | null
  task_kind: 'image' | 'video'
  provider_id: 'openai' | 'aliyun'
  model_key: string
  billing_mode: 'workspace_key' | 'platform'
  request_json: unknown
  status: GenerationTaskStatus
  progress: number
  attempt_count: number
  max_attempts: number
  error_code: string | null
  error_message: string | null
  cancel_requested_at: Date | string | null
  started_at: Date | string | null
  finished_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface TaskCommandRow {
  task_id: string
  command_type: 'cancel' | 'retry'
}

interface GenerationTaskEventRow {
  id: string
  task_id: string
  project_id: string
  event_type: 'created' | 'status' | 'progress' | 'terminal'
  status: GenerationTaskStatus
  progress: number
  error_code: string | null
  error_message: string | null
  sequence: string | number
  created_at: Date | string
}

export interface ListGenerationTasksInput {
  projectId?: string | null
  status?: string | null
  cursor?: string | null
  limit?: number
}

export interface ListGenerationTaskEventsInput {
  projectId?: string | null
  taskId?: string | null
  after?: string | null
  limit?: number
}

export interface GenerationTaskOperationalMetrics {
  queueBacklog: number
  runningTasks: number
  expiredLeases: number
  retryableFailures: number
}

export interface GenerationTaskService {
  createTask: (input: CreateGenerationTaskRequest, actor: ProjectActor) => Promise<GenerationTaskResponse>
  listTasks: (input: ListGenerationTasksInput, actor: ProjectActor) => Promise<GenerationTasksResponse>
  getTask: (taskId: string, actor: ProjectActor) => Promise<GenerationTaskResponse>
  cancelTask: (
    taskId: string,
    input: GenerationTaskCommandRequest,
    actor: ProjectActor,
  ) => Promise<GenerationTaskResponse>
  retryTask: (
    taskId: string,
    input: GenerationTaskCommandRequest,
    actor: ProjectActor,
  ) => Promise<GenerationTaskResponse>
  listEvents?: (
    input: ListGenerationTaskEventsInput,
    actor: ProjectActor,
  ) => Promise<GenerationTaskEventsResponse>
  getOperationalMetrics?: () => Promise<GenerationTaskOperationalMetrics>
}

function validationError(message: string): never {
  throw new AuthServiceError({ statusCode: 400, apiCode: 'VALIDATION_FAILED', message })
}

function conflictError(message: string): never {
  throw new AuthServiceError({ statusCode: 409, apiCode: 'VALIDATION_FAILED', message })
}

function resourceNotFound(): never {
  throw new AuthServiceError({ statusCode: 404, apiCode: 'RESOURCE_NOT_FOUND', message: 'Task not found' })
}

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 || value.length > maxLength) {
    return validationError(`${field} must be between 1 and ${maxLength} trimmed characters`)
  }
  return value
}

function requireUuid(value: unknown, field: string) {
  const normalized = requireString(value, field, 64).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    return validationError(`${field} must be a valid UUID`)
  }
  return normalized
}

function assertJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > 12) {
    return validationError(`${path} exceeds the maximum nesting depth`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return validationError(`${path} contains a non-finite number`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1))
    return
  }
  if (typeof value !== 'object') {
    return validationError(`${path} must contain JSON values only`)
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_PARAMETER_KEYS.has(key.toLowerCase())) {
      return validationError(`${path} must not contain Provider credentials or target URLs`)
    }
    assertJsonValue(item, `${path}.${key}`, depth + 1)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

export function validateCreateGenerationTaskRequest(input: CreateGenerationTaskRequest): CreateGenerationTaskRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return validationError('Generation task request must be an object')
  }
  const kind = requireString(input.kind, 'kind', 16)
  if (kind !== 'image' && kind !== 'video') {
    return validationError('kind must be image or video')
  }
  const billingMode = input.billingMode ?? 'workspace_key'
  if (billingMode !== 'workspace_key') {
    return validationError('Only workspace_key billing is currently available')
  }
  if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)) {
    return validationError('parameters must be an object')
  }
  assertJsonValue(input.parameters, 'parameters', 0)
  let parametersJson: string
  try {
    parametersJson = JSON.stringify(input.parameters)
  } catch {
    return validationError('parameters must be JSON serializable')
  }
  if (Buffer.byteLength(parametersJson, 'utf8') > GENERATION_TASK_PARAMETERS_MAX_BYTES) {
    return validationError(`parameters must be at most ${GENERATION_TASK_PARAMETERS_MAX_BYTES} bytes`)
  }
  return {
    projectId: requireUuid(input.projectId, 'projectId'),
    sourceNodeId: requireString(input.sourceNodeId, 'sourceNodeId', 128),
    previewNodeId: input.previewNodeId == null ? null : requireString(input.previewNodeId, 'previewNodeId', 128),
    kind,
    providerId: requireString(input.providerId, 'providerId', 80),
    model: requireString(input.model, 'model', 160),
    billingMode,
    parameters: input.parameters,
    idempotencyKey: requireString(input.idempotencyKey, 'idempotencyKey', 200),
  }
}

function validateCommandRequest(input: GenerationTaskCommandRequest) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return validationError('Task command request must be an object')
  }
  return { idempotencyKey: requireString(input.idempotencyKey, 'idempotencyKey', 200) }
}

function toIso(value: Date | string | null) {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toTaskSummary(row: GenerationTaskRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceNodeId: row.source_node_id,
    previewNodeId: row.preview_node_id,
    kind: row.task_kind,
    providerId: row.provider_id,
    model: row.model_key,
    billingMode: row.billing_mode,
    status: row.status,
    progress: row.progress,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    cancelRequestedAt: toIso(row.cancel_requested_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  }
}

function taskColumns(alias = 't') {
  return `
    ${alias}.id::text, ${alias}.project_id::text, ${alias}.source_node_id,
    ${alias}.preview_node_id, ${alias}.task_kind, ${alias}.provider_id,
    ${alias}.model_key, ${alias}.billing_mode, ${alias}.request_json,
    ${alias}.status, ${alias}.progress, ${alias}.attempt_count, ${alias}.max_attempts,
    ${alias}.error_code, ${alias}.error_message, ${alias}.cancel_requested_at,
    ${alias}.started_at, ${alias}.finished_at, ${alias}.created_at, ${alias}.updated_at
  `
}

function encodeCursor(row: GenerationTaskRow) {
  return Buffer.from(JSON.stringify({ createdAt: toIso(row.created_at), id: row.id }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined) {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !('createdAt' in parsed) || typeof parsed.createdAt !== 'string'
      || !Number.isFinite(new Date(parsed.createdAt).getTime())
      || !('id' in parsed) || typeof parsed.id !== 'string' || !UUID_PATTERN.test(parsed.id)
    ) {
      return validationError('Invalid task cursor')
    }
    return { createdAt: parsed.createdAt, id: parsed.id.toLowerCase() }
  } catch {
    return validationError('Invalid task cursor')
  }
}

function decodeEventCursor(value: string | null | undefined) {
  if (!value) return null
  if (!/^[0-9]{1,20}$/.test(value) || value === '0') {
    return validationError('Invalid task event cursor')
  }
  return value
}

function sanitizeTaskEventErrorMessage(value: string | null) {
  if (value === null) return null
  const normalized = value.trim()
    .replace(/(https?:\/\/)[^\s@/]+@/gi, '$1[redacted]@')
    .replace(/\b(password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  return (normalized || 'Task execution failed').slice(0, 1000)
}

function toTaskEvent(row: GenerationTaskEventRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    type: row.event_type,
    status: row.status,
    progress: row.progress,
    errorCode: row.error_code,
    errorMessage: sanitizeTaskEventErrorMessage(row.error_message),
    createdAt: toIso(row.created_at)!,
  }
}

async function readTask(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  taskId: string,
  lock = false,
) {
  const result = await client.query<GenerationTaskRow>(
    `SELECT ${taskColumns()} FROM generation_tasks t
     WHERE t.workspace_id = $1 AND t.id = $2
     ${lock ? 'FOR UPDATE' : ''}`,
    [workspaceId, taskId],
  )
  return result.rows[0] ?? null
}

function existingMatches(row: GenerationTaskRow, input: CreateGenerationTaskRequest) {
  return row.project_id === input.projectId
    && row.source_node_id === input.sourceNodeId
    && row.preview_node_id === (input.previewNodeId ?? null)
    && row.task_kind === input.kind
    && row.provider_id === input.providerId
    && row.model_key === input.model
    && row.billing_mode === (input.billingMode ?? 'workspace_key')
    && canonicalJson(row.request_json) === canonicalJson(input.parameters)
}

async function requireProjectNodes(client: DbClient, input: CreateGenerationTaskRequest, workspaceId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT p.id::text
      FROM projects p
      JOIN project_nodes source
        ON source.project_id = p.id AND source.node_id = $3 AND source.deleted_at IS NULL
      WHERE p.id = $1 AND p.workspace_id = $2
        AND p.deleted_at IS NULL AND p.archived_at IS NULL
        AND (
          $4::text IS NULL OR EXISTS (
            SELECT 1 FROM project_nodes preview
            WHERE preview.project_id = p.id AND preview.node_id = $4 AND preview.deleted_at IS NULL
          )
        )
    `,
    [input.projectId, workspaceId, input.sourceNodeId, input.previewNodeId ?? null],
  )
  if (!result.rows[0]) {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: 'RESOURCE_NOT_FOUND',
      message: 'Project or task node not found',
    })
  }
}

async function readCommand(client: DbClient, workspaceId: string, idempotencyKey: string) {
  const result = await client.query<TaskCommandRow>(
    `SELECT task_id::text, command_type FROM task_commands
     WHERE workspace_id = $1 AND idempotency_key = $2`,
    [workspaceId, idempotencyKey],
  )
  return result.rows[0] ?? null
}

async function insertCommand(
  client: DbClient,
  input: { workspaceId: string; taskId: string; commandType: 'cancel' | 'retry'; idempotencyKey: string; userId: string },
) {
  await client.query(
    `INSERT INTO task_commands (
       workspace_id, task_id, command_type, idempotency_key, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [input.workspaceId, input.taskId, input.commandType, input.idempotencyKey, input.userId],
  )
}

export function createPostgresGenerationTaskService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): GenerationTaskService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)

  async function authorize(actor: ProjectActor, write = false) {
    await authorizationService.requireWorkspaceAccess({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      ...(write ? { allowedRoles: TASK_WRITE_ROLES } : {}),
    })
  }

  async function applyCommand(
    taskIdValue: string,
    inputValue: GenerationTaskCommandRequest,
    actor: ProjectActor,
    commandType: 'cancel' | 'retry',
  ) {
    const taskId = requireUuid(taskIdValue, 'taskId')
    const input = validateCommandRequest(inputValue)
    await authorize(actor, true)
    return withTransaction(pool, async (client) => {
      await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [actor.workspaceId])
      const task = await readTask(client, actor.workspaceId, taskId, true) ?? resourceNotFound()
      const existing = await readCommand(client, actor.workspaceId, input.idempotencyKey)
      if (existing) {
        if (existing.task_id !== taskId || existing.command_type !== commandType) {
          return conflictError('Task command idempotency key was already used for another command')
        }
        return { task: toTaskSummary(task) }
      }

      let updated = task
      if (commandType === 'cancel') {
        if (!['queued', 'running', 'canceled'].includes(task.status)) {
          return conflictError('Only queued or running tasks can be canceled')
        }
        if (task.status === 'queued') {
          const result = await client.query<GenerationTaskRow>(
            `UPDATE generation_tasks
             SET status = 'canceled', cancel_requested_at = now(), finished_at = now(), updated_at = now()
             WHERE workspace_id = $1 AND id = $2 AND status = 'queued'
             RETURNING ${taskColumns('generation_tasks')}`,
            [actor.workspaceId, taskId],
          )
          updated = result.rows[0] ?? task
        } else if (task.status === 'running' && task.cancel_requested_at === null) {
          const result = await client.query<GenerationTaskRow>(
            `UPDATE generation_tasks SET cancel_requested_at = now(), updated_at = now()
             WHERE workspace_id = $1 AND id = $2 AND status = 'running'
             RETURNING ${taskColumns('generation_tasks')}`,
            [actor.workspaceId, taskId],
          )
          updated = result.rows[0] ?? task
        }
      } else {
        if (task.status !== 'failed') {
          return conflictError('Only failed tasks can be retried')
        }
        if (task.attempt_count >= task.max_attempts) {
          return conflictError('Task retry limit has been reached')
        }
        const result = await client.query<GenerationTaskRow>(
          `UPDATE generation_tasks
           SET status = 'queued', progress = 0, available_at = now(),
               error_code = NULL, error_message = NULL, cancel_requested_at = NULL,
               finished_at = NULL, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 AND status = 'failed'
           RETURNING ${taskColumns('generation_tasks')}`,
          [actor.workspaceId, taskId],
        )
        updated = result.rows[0] ?? conflictError('Task state changed before retry')
        await insertTaskQueueDispatch(client, {
          workspaceId: actor.workspaceId,
          taskId,
          attemptNumber: task.attempt_count + 1,
        })
      }
      await insertCommand(client, {
        workspaceId: actor.workspaceId,
        taskId,
        commandType,
        idempotencyKey: input.idempotencyKey,
        userId: actor.userId,
      })
      return { task: toTaskSummary(updated) }
    })
  }

  return {
    async createTask(inputValue, actor) {
      const input = validateCreateGenerationTaskRequest(inputValue)
      await authorize(actor, true)
      return withTransaction(pool, async (client) => {
        await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [actor.workspaceId])
        const existingResult = await client.query<GenerationTaskRow>(
          `SELECT ${taskColumns()} FROM generation_tasks t
           WHERE t.workspace_id = $1 AND t.idempotency_key = $2`,
          [actor.workspaceId, input.idempotencyKey],
        )
        const existing = existingResult.rows[0]
        if (existing) {
          if (!existingMatches(existing, input)) {
            return conflictError('Task idempotency key was already used for different input')
          }
          return { task: toTaskSummary(existing) }
        }

        await requireProjectNodes(client, input, actor.workspaceId)
        await lockConfiguredProviderCredential(client, actor.workspaceId, input.providerId)
        if (!isProviderGenerationTaskEnabled({
          providerId: input.providerId,
          kind: input.kind,
          model: input.model,
        })) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: 'PROVIDER_CAPABILITY_UNSUPPORTED',
            message: 'Provider task capability is not enabled',
          })
        }
        const active = await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM generation_tasks
           WHERE workspace_id = $1 AND status IN ('queued', 'running')`,
          [actor.workspaceId],
        )
        if ((active.rows[0]?.count ?? 0) >= GENERATION_TASK_ACTIVE_LIMIT) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: 'TASK_CONCURRENCY_LIMIT',
            message: 'Workspace active task limit reached',
            details: { activeLimit: GENERATION_TASK_ACTIVE_LIMIT },
          })
        }

        const result = await client.query<GenerationTaskRow>(
          `INSERT INTO generation_tasks (
             workspace_id, project_id, created_by_user_id, source_node_id, preview_node_id,
             task_kind, provider_id, model_key, billing_mode, request_json, idempotency_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
           RETURNING ${taskColumns('generation_tasks')}`,
          [
            actor.workspaceId, input.projectId, actor.userId, input.sourceNodeId,
            input.previewNodeId ?? null, input.kind, input.providerId, input.model,
            input.billingMode ?? 'workspace_key', JSON.stringify(input.parameters), input.idempotencyKey,
          ],
        )
        await insertTaskQueueDispatch(client, {
          workspaceId: actor.workspaceId,
          taskId: result.rows[0]!.id,
          attemptNumber: 1,
        })
        await client.query(
          `UPDATE projects SET task_count = task_count + 1, updated_at = now()
           WHERE workspace_id = $1 AND id = $2`,
          [actor.workspaceId, input.projectId],
        )
        return { task: toTaskSummary(result.rows[0]!) }
      })
    },

    async listTasks(input, actor) {
      await authorize(actor)
      const limit = input.limit ?? GENERATION_TASK_DEFAULT_LIMIT
      if (!Number.isInteger(limit) || limit < 1 || limit > GENERATION_TASK_MAX_LIMIT) {
        return validationError(`limit must be between 1 and ${GENERATION_TASK_MAX_LIMIT}`)
      }
      const projectId = input.projectId == null ? null : requireUuid(input.projectId, 'projectId')
      const status = input.status == null ? null : input.status
      if (status !== null && !TASK_STATUSES.has(status)) {
        return validationError('Invalid task status')
      }
      const cursor = decodeCursor(input.cursor)
      const result = await pool.query<GenerationTaskRow>(
        `SELECT ${taskColumns()} FROM generation_tasks t
         WHERE t.workspace_id = $1
           AND ($2::uuid IS NULL OR t.project_id = $2)
           AND ($3::text IS NULL OR t.status = $3)
           AND ($4::timestamptz IS NULL OR (t.created_at, t.id) < ($4, $5::uuid))
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT $6`,
        [actor.workspaceId, projectId, status, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      )
      const rows = result.rows.slice(0, limit)
      return {
        tasks: rows.map(toTaskSummary),
        nextCursor: result.rows.length > limit && rows.length > 0 ? encodeCursor(rows.at(-1)!) : null,
      }
    },

    async listEvents(input, actor) {
      await authorize(actor)
      const limit = input.limit ?? 100
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return validationError('limit must be between 1 and 200')
      }
      const projectId = input.projectId == null ? null : requireUuid(input.projectId, 'projectId')
      const taskId = input.taskId == null ? null : requireUuid(input.taskId, 'taskId')
      const after = decodeEventCursor(input.after)
      const result = await pool.query<GenerationTaskEventRow>(
        `SELECT e.id::text, e.task_id::text, e.project_id::text, e.event_type,
                e.status, e.progress, e.error_code, e.error_message,
                e.sequence::text, e.created_at
         FROM generation_task_events e
         WHERE e.workspace_id = $1
           AND ($2::uuid IS NULL OR e.project_id = $2)
           AND ($3::uuid IS NULL OR e.task_id = $3)
           AND ($4::bigint IS NULL OR e.sequence > $4::bigint)
         ORDER BY e.sequence ASC
         LIMIT $5` ,
        [actor.workspaceId, projectId, taskId, after, limit + 1],
      )
      const rows = result.rows.slice(0, limit)
      return {
        events: rows.map(toTaskEvent),
        nextCursor: rows.length > 0 ? String(rows.at(-1)!.sequence) : after,
        hasMore: result.rows.length > limit,
      }
    },

    async getOperationalMetrics() {
      const result = await pool.query<{
        queue_backlog: string | number
        running_tasks: string | number
        expired_leases: string | number
        retryable_failures: string | number
      }>(
        `SELECT
           count(*) FILTER (WHERE status = 'queued')::integer AS queue_backlog,
           count(*) FILTER (WHERE status = 'running')::integer AS running_tasks,
           count(*) FILTER (WHERE status = 'running' AND lease_expires_at <= now())::integer AS expired_leases,
           count(*) FILTER (WHERE status = 'failed' AND attempt_count < max_attempts)::integer AS retryable_failures
         FROM generation_tasks`,
      )
      const row = result.rows[0]
      return {
        queueBacklog: Number(row?.queue_backlog ?? 0),
        runningTasks: Number(row?.running_tasks ?? 0),
        expiredLeases: Number(row?.expired_leases ?? 0),
        retryableFailures: Number(row?.retryable_failures ?? 0),
      }
    },

    async getTask(taskIdValue, actor) {
      const taskId = requireUuid(taskIdValue, 'taskId')
      await authorize(actor)
      const row = await readTask(pool, actor.workspaceId, taskId) ?? resourceNotFound()
      return { task: toTaskSummary(row) }
    },

    cancelTask(taskId, input, actor) {
      return applyCommand(taskId, input, actor, 'cancel')
    },

    retryTask(taskId, input, actor) {
      return applyCommand(taskId, input, actor, 'retry')
    },
  }
}

export function createUnavailableGenerationTaskService(): GenerationTaskService {
  const unavailable = (): never => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Generation task service is not configured',
      retryable: true,
    })
  }
  return {
    async createTask() { return unavailable() },
    async listTasks() { return unavailable() },
    async getTask() { return unavailable() },
    async cancelTask() { return unavailable() },
    async retryTask() { return unavailable() },
    async listEvents() { return unavailable() },
    async getOperationalMetrics() { return unavailable() },
  }
}
