import { randomUUID } from 'node:crypto'
import type {
  AssetKind,
  AssetResponse,
  AssetSummary,
  AssetUploadResponse,
  AssetUploadSummary,
  AssetUrlResponse,
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
  WorkspaceRole,
} from '@ai-canvas-cloud/contracts'
import type { DbPool, DbClient } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from '../workspaces/authorization.js'
import {
  assertWorkspaceStorageCapacity,
  lockWorkspaceStorageQuota,
  readWorkspaceStorageUsage,
} from '../workspaces/usage.js'

export const ASSET_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
const FILE_NAME_MAX_LENGTH = 255
const MIME_TYPE_MAX_LENGTH = 120
const IDEMPOTENCY_KEY_MAX_LENGTH = 200
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])
const ALLOWED_ASSET_KINDS = new Set(['upload', 'generated', 'edit', 'crop', 'thumbnail', 'preview', 'video'])
const ALLOWED_REFERENCE_ROLES = new Set(['source', 'result', 'thumbnail', 'preview', 'mask', 'attachment'])
const ASSET_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'editor']
const UPLOAD_URL_TTL_SECONDS = 15 * 60
const READ_URL_TTL_SECONDS = 5 * 60

export interface AssetService {
  createUpload: (
    input: CreateAssetUploadRequest,
    actor: ProjectActor,
  ) => Promise<AssetUploadResponse>
  completeUpload: (
    uploadId: string,
    actor: ProjectActor,
  ) => Promise<CompleteAssetUploadResponse>
  getAsset: (
    assetId: string,
    actor: ProjectActor,
  ) => Promise<AssetResponse>
  getAssetUrl: (
    assetId: string,
    actor: ProjectActor,
  ) => Promise<AssetUrlResponse>
}

export interface AssetObjectStorage {
  createPresignedUpload: (input: {
    objectKey: string
    mimeType: string
    byteSize: number
    expiresInSeconds: number
  }) => Promise<AssetUploadResponse['directUpload']>
  createPresignedDownload: (input: {
    objectKey: string
    expiresInSeconds: number
  }) => Promise<Pick<AssetUrlResponse, 'url' | 'expiresAt'>>
  getObjectMetadata: (objectKey: string) => Promise<{
    byteSize: number
    mimeType: string | null
  }>
  calculateObjectSha256: (objectKey: string) => Promise<string>
}

interface AssetRow {
  asset_id: string
  project_id: string | null
  original_file_name: string | null
  asset_mime_type: string
  asset_byte_size: string | number
  asset_sha256: string | null
  width: number | null
  height: number | null
  asset_kind: AssetKind
  asset_status: AssetSummary['status']
  asset_created_at: Date | string
  asset_updated_at: Date | string
  object_key: string
}

interface AssetUploadRow extends AssetRow {
  upload_id: string
  original_file_name: string
  expected_mime_type: string
  expected_byte_size: string | number
  expected_sha256: string | null
  asset_kind: AssetKind
  upload_status: AssetUploadSummary['status']
  expires_at: Date | string
  upload_created_at: Date | string
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: 'VALIDATION_FAILED',
    message,
  })
}

function resourceNotFound(message: string): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: 'RESOURCE_NOT_FOUND',
    message,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireTrimmedString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    return validationError(`${field} must be a string`)
  }

  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > maxLength) {
    return validationError(`${field} must be between 1 and ${maxLength} characters`)
  }

  return normalized
}

function normalizeOptionalProjectId(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const projectId = requireTrimmedString(value, 'projectId', 64)
  if (!UUID_PATTERN.test(projectId)) {
    return validationError('projectId must be a valid UUID')
  }

  return projectId.toLowerCase()
}

function normalizeOptionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return null
  }

  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    return validationError(`${field} must be a positive safe integer`)
  }

  return Number(value)
}

function normalizeOptionalSha256(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const sha256 = requireTrimmedString(value, 'sha256', 64).toLowerCase()
  if (!SHA256_PATTERN.test(sha256)) {
    return validationError('sha256 must be a lowercase hex SHA-256 digest')
  }

  return sha256
}

export function validateCreateAssetUploadRequest(input: CreateAssetUploadRequest): CreateAssetUploadRequest {
  if (!isRecord(input)) {
    return validationError('Asset upload request must be an object')
  }

  const originalFileName = requireTrimmedString(input.originalFileName, 'originalFileName', FILE_NAME_MAX_LENGTH)
  if (originalFileName.includes('/') || originalFileName.includes('\\')) {
    return validationError('originalFileName must not contain path separators')
  }

  const mimeType = requireTrimmedString(input.mimeType, 'mimeType', MIME_TYPE_MAX_LENGTH).toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return validationError('mimeType is not allowed')
  }

  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > ASSET_UPLOAD_MAX_BYTES) {
    return validationError(`byteSize must be between 1 and ${ASSET_UPLOAD_MAX_BYTES}`)
  }

  const assetKind = requireTrimmedString(input.assetKind, 'assetKind', 32)
  if (!ALLOWED_ASSET_KINDS.has(assetKind)) {
    return validationError('assetKind is not allowed')
  }

  const referenceRole = input.referenceRole === undefined || input.referenceRole === null
    ? undefined
    : requireTrimmedString(input.referenceRole, 'referenceRole', 32)
  if (referenceRole !== undefined && !ALLOWED_REFERENCE_ROLES.has(referenceRole)) {
    return validationError('referenceRole is not allowed')
  }

  return {
    projectId: normalizeOptionalProjectId(input.projectId),
    originalFileName,
    mimeType,
    byteSize: input.byteSize,
    sha256: normalizeOptionalSha256(input.sha256),
    width: normalizeOptionalPositiveInteger(input.width, 'width'),
    height: normalizeOptionalPositiveInteger(input.height, 'height'),
    assetKind,
    ...(referenceRole === undefined ? {} : { referenceRole }),
    idempotencyKey: requireTrimmedString(input.idempotencyKey, 'idempotencyKey', IDEMPOTENCY_KEY_MAX_LENGTH),
  } as CreateAssetUploadRequest
}

function validateUploadId(uploadId: unknown) {
  const normalized = requireTrimmedString(uploadId, 'uploadId', 64)
  if (!UUID_PATTERN.test(normalized)) {
    return validationError('uploadId must be a valid UUID')
  }

  return normalized.toLowerCase()
}

function validateAssetId(assetId: unknown) {
  const normalized = requireTrimmedString(assetId, 'assetId', 64)
  if (!UUID_PATTERN.test(normalized)) {
    return validationError('assetId must be a valid UUID')
  }

  return normalized.toLowerCase()
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toAssetSummary(row: AssetRow): AssetSummary {
  return {
    id: row.asset_id,
    projectId: row.project_id,
    originalFileName: row.original_file_name,
    mimeType: row.asset_mime_type,
    byteSize: Number(row.asset_byte_size),
    sha256: row.asset_sha256,
    width: row.width,
    height: row.height,
    assetKind: row.asset_kind,
    status: row.asset_status,
    createdAt: toIso(row.asset_created_at),
    updatedAt: toIso(row.asset_updated_at),
  }
}

function assertAssetReadable(row: AssetRow) {
  if (row.asset_status !== 'completed') {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_NOT_READY',
      message: 'Asset is not ready for reading',
    })
  }
}

function toUploadSummary(row: AssetUploadRow): AssetUploadSummary {
  return {
    id: row.upload_id,
    assetId: row.asset_id,
    projectId: row.project_id,
    originalFileName: row.original_file_name,
    expectedMimeType: row.expected_mime_type,
    expectedByteSize: Number(row.expected_byte_size),
    expectedSha256: row.expected_sha256,
    assetKind: row.asset_kind,
    status: row.upload_status,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.upload_created_at),
  }
}

function assertExistingUploadMatchesRequest(row: AssetUploadRow, request: CreateAssetUploadRequest) {
  const mismatched = row.project_id !== (request.projectId ?? null)
    || row.original_file_name !== request.originalFileName
    || row.expected_mime_type !== request.mimeType
    || Number(row.expected_byte_size) !== request.byteSize
    || row.expected_sha256 !== (request.sha256 ?? null)
    || row.asset_kind !== request.assetKind

  if (mismatched) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'VALIDATION_FAILED',
      message: 'Asset upload idempotency key was already used for different metadata',
    })
  }

  if (row.upload_status !== 'pending' || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_UPLOAD_EXPIRED',
      message: 'Asset upload is no longer pending',
    })
  }
}

function assertUploadCanBeCompleted(row: AssetUploadRow) {
  if (row.upload_status === 'completed' && row.asset_status === 'completed') {
    return 'completed' as const
  }

  if (row.upload_status !== 'pending' || row.asset_status !== 'pending') {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_NOT_READY',
      message: 'Asset upload is not pending',
    })
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_UPLOAD_EXPIRED',
      message: 'Asset upload is expired',
    })
  }

  return 'pending' as const
}

function normalizeMimeType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

async function assertUploadedObjectMatches(
  objectStorage: AssetObjectStorage,
  row: AssetUploadRow,
) {
  let metadata: Awaited<ReturnType<AssetObjectStorage['getObjectMetadata']>>

  try {
    metadata = await objectStorage.getObjectMetadata(row.object_key)
  } catch (error) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_NOT_READY',
      message: 'Uploaded object is not available',
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
  }

  if (metadata.byteSize !== Number(row.expected_byte_size)) {
    throw new AuthServiceError({
      statusCode: 422,
      apiCode: 'ASSET_VALIDATION_FAILED',
      message: 'Uploaded object size does not match the upload session',
      details: {
        expectedByteSize: Number(row.expected_byte_size),
        actualByteSize: metadata.byteSize,
      },
    })
  }

  const actualMimeType = normalizeMimeType(metadata.mimeType)
  if (actualMimeType && actualMimeType !== row.expected_mime_type) {
    throw new AuthServiceError({
      statusCode: 422,
      apiCode: 'ASSET_VALIDATION_FAILED',
      message: 'Uploaded object MIME type does not match the upload session',
      details: {
        expectedMimeType: row.expected_mime_type,
        actualMimeType,
      },
    })
  }

  if (row.expected_sha256) {
    const actualSha256 = await objectStorage.calculateObjectSha256(row.object_key)

    if (actualSha256 !== row.expected_sha256) {
      throw new AuthServiceError({
        statusCode: 422,
        apiCode: 'ASSET_VALIDATION_FAILED',
        message: 'Uploaded object SHA-256 does not match the upload session',
      })
    }
  }
}

function getExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }
  if (mimeType === 'image/png') {
    return 'png'
  }
  if (mimeType === 'image/webp') {
    return 'webp'
  }
  if (mimeType === 'video/webm') {
    return 'webm'
  }
  if (mimeType === 'video/quicktime') {
    return 'mov'
  }
  return 'mp4'
}

function createObjectKey(input: {
  workspaceId: string
  projectId: string | null
  assetId: string
  mimeType: string
  assetKind: string
}) {
  const projectSegment = input.projectId ? `projects/${input.projectId}` : 'workspace'
  const kindSegment = input.assetKind === 'generated'
    ? `generated/${new Date().toISOString().slice(0, 10)}`
    : input.assetKind === 'edit'
      ? 'edits'
      : input.assetKind === 'crop'
        ? 'crops'
        : input.assetKind === 'thumbnail'
          ? 'thumbnails'
          : input.assetKind === 'preview'
            ? 'previews'
            : input.assetKind === 'video'
              ? 'videos'
              : 'uploads'
  return `workspaces/${input.workspaceId}/${projectSegment}/${kindSegment}/${input.assetId}.${getExtension(input.mimeType)}`
}

async function findUploadByIdempotencyKey(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const result = await client.query<AssetUploadRow>(
    `
      SELECT
        au.id::text AS upload_id,
        au.asset_id::text AS asset_id,
        au.project_id::text AS project_id,
        au.original_file_name,
        au.expected_mime_type,
        au.expected_byte_size,
        au.expected_sha256,
        au.asset_kind,
        au.status AS upload_status,
        au.expires_at,
        au.created_at AS upload_created_at,
        a.mime_type AS asset_mime_type,
        a.byte_size AS asset_byte_size,
        a.sha256 AS asset_sha256,
        a.width,
        a.height,
        a.status AS asset_status,
        a.created_at AS asset_created_at,
        a.updated_at AS asset_updated_at,
        a.object_key
      FROM asset_uploads au
      JOIN assets a ON a.workspace_id = au.workspace_id AND a.id = au.asset_id
      WHERE au.workspace_id = $1
        AND au.idempotency_key = $2
      LIMIT 1
    `,
    [workspaceId, idempotencyKey],
  )

  return result.rows[0] ?? null
}

async function findUploadById(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  uploadId: string,
) {
  const result = await client.query<AssetUploadRow>(
    `
      SELECT
        au.id::text AS upload_id,
        au.asset_id::text AS asset_id,
        au.project_id::text AS project_id,
        au.original_file_name,
        au.expected_mime_type,
        au.expected_byte_size,
        au.expected_sha256,
        au.asset_kind,
        au.status AS upload_status,
        au.expires_at,
        au.created_at AS upload_created_at,
        a.mime_type AS asset_mime_type,
        a.byte_size AS asset_byte_size,
        a.sha256 AS asset_sha256,
        a.width,
        a.height,
        a.status AS asset_status,
        a.created_at AS asset_created_at,
        a.updated_at AS asset_updated_at,
        a.object_key
      FROM asset_uploads au
      JOIN assets a ON a.workspace_id = au.workspace_id AND a.id = au.asset_id
      WHERE au.workspace_id = $1
        AND au.id = $2
      LIMIT 1
    `,
    [workspaceId, uploadId],
  )

  return result.rows[0] ?? null
}

async function findAssetById(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  assetId: string,
) {
  const result = await client.query<AssetRow>(
    `
      SELECT
        a.id::text AS asset_id,
        a.origin_project_id::text AS project_id,
        a.original_file_name,
        a.mime_type AS asset_mime_type,
        a.byte_size AS asset_byte_size,
        a.sha256 AS asset_sha256,
        a.width,
        a.height,
        a.asset_kind,
        a.status AS asset_status,
        a.created_at AS asset_created_at,
        a.updated_at AS asset_updated_at,
        a.object_key
      FROM assets a
      WHERE a.workspace_id = $1
        AND a.id = $2
        AND a.deleted_at IS NULL
        AND a.status <> 'deleted'
      LIMIT 1
    `,
    [workspaceId, assetId],
  )

  return result.rows[0] ?? null
}

async function markUploadCompleted(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  uploadId: string,
) {
  const result = await client.query<AssetUploadRow>(
    `
      WITH locked_upload AS (
        SELECT au.*
        FROM asset_uploads au
        WHERE au.workspace_id = $1
          AND au.id = $2
        FOR UPDATE
      ),
      updated_asset AS (
        UPDATE assets a
        SET status = 'completed',
            updated_at = now()
        FROM locked_upload lu
        WHERE a.workspace_id = lu.workspace_id
          AND a.id = lu.asset_id
          AND a.status = 'pending'
        RETURNING a.*
      ),
      updated_upload AS (
        UPDATE asset_uploads au
        SET status = 'completed',
            completed_at = COALESCE(au.completed_at, now()),
            updated_at = now()
        WHERE au.workspace_id = $1
          AND au.id = $2
          AND au.status = 'pending'
        RETURNING au.*
      )
      SELECT
        COALESCE(uu.id, lu.id)::text AS upload_id,
        COALESCE(ua.id, a.id)::text AS asset_id,
        COALESCE(uu.project_id, lu.project_id)::text AS project_id,
        COALESCE(uu.original_file_name, lu.original_file_name) AS original_file_name,
        COALESCE(uu.expected_mime_type, lu.expected_mime_type) AS expected_mime_type,
        COALESCE(uu.expected_byte_size, lu.expected_byte_size) AS expected_byte_size,
        COALESCE(uu.expected_sha256, lu.expected_sha256) AS expected_sha256,
        COALESCE(uu.asset_kind, lu.asset_kind) AS asset_kind,
        COALESCE(uu.status, lu.status) AS upload_status,
        COALESCE(uu.expires_at, lu.expires_at) AS expires_at,
        COALESCE(uu.created_at, lu.created_at) AS upload_created_at,
        COALESCE(ua.mime_type, a.mime_type) AS asset_mime_type,
        COALESCE(ua.byte_size, a.byte_size) AS asset_byte_size,
        COALESCE(ua.sha256, a.sha256) AS asset_sha256,
        COALESCE(ua.width, a.width) AS width,
        COALESCE(ua.height, a.height) AS height,
        COALESCE(ua.status, a.status) AS asset_status,
        COALESCE(ua.created_at, a.created_at) AS asset_created_at,
        COALESCE(ua.updated_at, a.updated_at) AS asset_updated_at,
        COALESCE(ua.object_key, a.object_key) AS object_key
      FROM locked_upload lu
      JOIN assets a ON a.workspace_id = lu.workspace_id AND a.id = lu.asset_id
      LEFT JOIN updated_upload uu ON uu.id = lu.id
      LEFT JOIN updated_asset ua ON ua.id = lu.asset_id
      LIMIT 1
    `,
    [workspaceId, uploadId],
  )

  return result.rows[0] ?? null
}

async function assertProjectCanReceiveAsset(
  client: Pick<DbClient, 'query'>,
  projectId: string | null | undefined,
  workspaceId: string,
) {
  if (!projectId) {
    return null
  }

  const result = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM projects
      WHERE id = $1
        AND workspace_id = $2
        AND deleted_at IS NULL
        AND archived_at IS NULL
      LIMIT 1
    `,
    [projectId, workspaceId],
  )

  if (!result.rows[0]) {
    return resourceNotFound('Project not found')
  }

  return projectId
}

export function createPostgresAssetService(
  pool: DbPool,
  options: {
    authorizationService?: WorkspaceAuthorizationService
    objectStorage: AssetObjectStorage
    uploadUrlTtlSeconds?: number
    readUrlTtlSeconds?: number
  },
): AssetService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)
  const uploadUrlTtlSeconds = options.uploadUrlTtlSeconds ?? UPLOAD_URL_TTL_SECONDS
  const readUrlTtlSeconds = options.readUrlTtlSeconds ?? READ_URL_TTL_SECONDS

  async function createDirectUpload(row: AssetUploadRow) {
    return options.objectStorage.createPresignedUpload({
      objectKey: row.object_key,
      mimeType: row.expected_mime_type,
      byteSize: Number(row.expected_byte_size),
      expiresInSeconds: uploadUrlTtlSeconds,
    })
  }

  async function requireReadableAsset(assetId: string, actor: ProjectActor) {
    const normalizedAssetId = validateAssetId(assetId)
    await authorizationService.requireWorkspaceAccess({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    })

    const row = await findAssetById(pool, actor.workspaceId, normalizedAssetId)
    if (!row) {
      return resourceNotFound('Asset not found')
    }

    assertAssetReadable(row)
    return row
  }

  return {
    async createUpload(input, actor) {
      const request = validateCreateAssetUploadRequest(input)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: ASSET_WRITE_ROLES,
      })

      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        await lockWorkspaceStorageQuota(client, actor.workspaceId)

        const existing = await findUploadByIdempotencyKey(client, actor.workspaceId, request.idempotencyKey)
        if (existing) {
          assertExistingUploadMatchesRequest(existing, request)
          await client.query('COMMIT')
          return {
            upload: toUploadSummary(existing),
            asset: toAssetSummary(existing),
            directUpload: await createDirectUpload(existing),
          }
        }

        const projectId = await assertProjectCanReceiveAsset(client, request.projectId, actor.workspaceId)
        assertWorkspaceStorageCapacity(
          await readWorkspaceStorageUsage(client, actor.workspaceId),
          request.byteSize,
        )
        const assetId = randomUUID()
        const uploadId = randomUUID()
        const objectKey = createObjectKey({
          workspaceId: actor.workspaceId,
          projectId,
          assetId,
          mimeType: request.mimeType,
          assetKind: request.assetKind,
        })
        const expiresAt = new Date(Date.now() + uploadUrlTtlSeconds * 1000)

        const result = await client.query<AssetUploadRow>(
          `
            WITH inserted_asset AS (
              INSERT INTO assets (
                id,
                workspace_id,
                origin_project_id,
                created_by_user_id,
                object_key,
                original_file_name,
                mime_type,
                byte_size,
                sha256,
                width,
                height,
                asset_kind,
                status
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending'
              )
              RETURNING *
            ),
            inserted_upload AS (
              INSERT INTO asset_uploads (
                id,
                workspace_id,
                project_id,
                asset_id,
                created_by_user_id,
                object_key,
                original_file_name,
                expected_mime_type,
                expected_byte_size,
                expected_sha256,
                asset_kind,
                idempotency_key,
                status,
                expires_at
              ) VALUES (
                $13, $2, $3, $1, $4, $5, $6, $7, $8, $9, $12, $14, 'pending', $15
              )
              RETURNING *
            )
            SELECT
              iu.id::text AS upload_id,
              ia.id::text AS asset_id,
              iu.project_id::text AS project_id,
              iu.original_file_name,
              iu.expected_mime_type,
              iu.expected_byte_size,
              iu.expected_sha256,
              iu.asset_kind,
              iu.status AS upload_status,
              iu.expires_at,
              iu.created_at AS upload_created_at,
              ia.mime_type AS asset_mime_type,
              ia.byte_size AS asset_byte_size,
              ia.sha256 AS asset_sha256,
              ia.width,
              ia.height,
              ia.status AS asset_status,
              ia.created_at AS asset_created_at,
              ia.updated_at AS asset_updated_at,
              ia.object_key
            FROM inserted_upload iu
            JOIN inserted_asset ia ON ia.id = iu.asset_id
          `,
          [
            assetId,
            actor.workspaceId,
            projectId,
            actor.userId,
            objectKey,
            request.originalFileName,
            request.mimeType,
            request.byteSize,
            request.sha256,
            request.width,
            request.height,
            request.assetKind,
            uploadId,
            request.idempotencyKey,
            expiresAt,
          ],
        )
        const row = result.rows[0]

        if (!row) {
          throw new Error('Asset upload was not created')
        }

        await client.query('COMMIT')

        return {
          upload: toUploadSummary(row),
          asset: toAssetSummary(row),
          directUpload: await createDirectUpload(row),
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async completeUpload(uploadId, actor) {
      const normalizedUploadId = validateUploadId(uploadId)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: ASSET_WRITE_ROLES,
      })

      const before = await findUploadById(pool, actor.workspaceId, normalizedUploadId)
      if (!before) {
        return resourceNotFound('Asset upload not found')
      }

      const completionState = assertUploadCanBeCompleted(before)
      if (completionState === 'pending') {
        await assertUploadedObjectMatches(options.objectStorage, before)
      }

      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        const row = await markUploadCompleted(client, actor.workspaceId, normalizedUploadId)

        if (!row) {
          return resourceNotFound('Asset upload not found')
        }

        await client.query('COMMIT')

        return {
          upload: toUploadSummary(row),
          asset: toAssetSummary(row),
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async getAsset(assetId, actor) {
      const row = await requireReadableAsset(assetId, actor)
      return { asset: toAssetSummary(row) }
    },

    async getAssetUrl(assetId, actor) {
      const row = await requireReadableAsset(assetId, actor)
      const signed = await options.objectStorage.createPresignedDownload({
        objectKey: row.object_key,
        expiresInSeconds: readUrlTtlSeconds,
      })

      return {
        assetId: row.asset_id,
        ...signed,
      }
    },
  }
}

export function createUnavailableAssetService(): AssetService {
  return {
    async createUpload() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: 'SERVICE_UNAVAILABLE',
        message: 'Asset service is not configured',
        retryable: true,
      })
    },
    async completeUpload() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: 'SERVICE_UNAVAILABLE',
        message: 'Asset service is not configured',
        retryable: true,
      })
    },
    async getAsset() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: 'SERVICE_UNAVAILABLE',
        message: 'Asset service is not configured',
        retryable: true,
      })
    },
    async getAssetUrl() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: 'SERVICE_UNAVAILABLE',
        message: 'Asset service is not configured',
        retryable: true,
      })
    },
  }
}
