import { randomUUID } from 'node:crypto'
import {
  validateCompleteMigrationImportAssetUploadRequest,
  type CompleteMigrationImportAssetUploadRequest,
  type MigrationImportAssetUploadMode,
  type MigrationImportAssetUploadPart,
  type MigrationImportAssetUploadResponse,
  type MigrationImportAssetUploadStatus,
  type MigrationPackageAsset,
} from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { withTransaction } from '../../db/postgres.js'
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
import {
  MIGRATION_IMPORT_WRITE_ROLES,
  migrationImportNotFound,
  normalizeMigrationImportId,
  type MigrationImportObjectStorage,
} from './service.js'

export const MIGRATION_ASSET_UPLOAD_URL_TTL_SECONDS = 15 * 60
export const MIGRATION_ASSET_UPLOAD_TTL_HOURS = 24
export const MIGRATION_ASSET_MULTIPART_PART_SIZE = 8 * 1024 * 1024
export const MIGRATION_ASSET_MULTIPART_THRESHOLD = MIGRATION_ASSET_MULTIPART_PART_SIZE
export const MIGRATION_ASSET_MAX_PART_COUNT = 256

const LOGICAL_ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

interface MigrationImportRow {
  id: string
  status: string
  expires_at: Date | string
  total_file_count: string | number
  asset_count: string | number
  asset_manifest_json: { assets: MigrationPackageAsset[] }
}

interface CompletedPart {
  partNumber: number
  etag: string
  byteSize: number
}

interface MigrationAssetUploadRow {
  id: string
  workspace_id: string
  import_id: string
  logical_asset_id: string
  object_key: string
  provider_upload_id: string | null
  upload_mode: MigrationImportAssetUploadMode
  part_size: string | number
  part_count: number
  completed_parts_json: CompletedPart[]
  expected_file_path: string
  expected_original_file_name: string | null
  expected_mime_type: string
  expected_byte_size: string | number
  expected_sha256: string
  expected_width: number | null
  expected_height: number | null
  expected_asset_kind: MigrationPackageAsset['assetKind']
  status: MigrationImportAssetUploadStatus
  uploaded_byte_size: string | number
  retry_count: number
  error_code: string | null
  error_message: string | null
  expires_at: Date | string
  completed_at: Date | string | null
  canceled_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

const UPLOAD_COLUMNS = `
  id::text,
  workspace_id::text,
  import_id::text,
  logical_asset_id,
  object_key,
  provider_upload_id,
  upload_mode,
  part_size,
  part_count,
  completed_parts_json,
  expected_file_path,
  expected_original_file_name,
  expected_mime_type,
  expected_byte_size,
  expected_sha256,
  expected_width,
  expected_height,
  expected_asset_kind,
  status,
  uploaded_byte_size,
  retry_count,
  error_code,
  error_message,
  expires_at,
  completed_at,
  canceled_at,
  created_at,
  updated_at
`

function validationError(message: string): never {
  throw new AuthServiceError({ statusCode: 400, apiCode: 'VALIDATION_FAILED', message })
}

function importConflict(message: string): never {
  throw new AuthServiceError({ statusCode: 409, apiCode: 'IMPORT_CONFLICT', message })
}

function uploadNotFound(): never {
  throw new AuthServiceError({ statusCode: 404, apiCode: 'RESOURCE_NOT_FOUND', message: 'Migration asset upload not found' })
}

function uploadInvalid(message: string, details?: Record<string, unknown>): never {
  throw new AuthServiceError({
    statusCode: 422,
    apiCode: 'ASSET_VALIDATION_FAILED',
    message,
    details,
  })
}

function normalizeLogicalAssetId(value: unknown) {
  if (typeof value !== 'string' || !LOGICAL_ASSET_ID_PATTERN.test(value)) {
    return validationError('logicalAssetId must be a valid portable asset ID')
  }
  return value
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toSafeInteger(value: string | number, field: string) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return number
}

function partByteSize(row: MigrationAssetUploadRow, partNumber: number) {
  if (partNumber < 1 || partNumber > row.part_count) {
    return validationError('partNumber is outside the upload range')
  }
  const total = toSafeInteger(row.expected_byte_size, 'expectedByteSize')
  const size = toSafeInteger(row.part_size, 'partSize')
  const start = (partNumber - 1) * size
  return Math.min(size, total - start)
}

function calculatePartCount(expectedByteSize: number) {
  const partCount = expectedByteSize > MIGRATION_ASSET_MULTIPART_THRESHOLD
    ? Math.ceil(expectedByteSize / MIGRATION_ASSET_MULTIPART_PART_SIZE)
    : 1
  if (partCount > MIGRATION_ASSET_MAX_PART_COUNT) {
    validationError('Migration asset exceeds the multipart part count limit')
  }
  return partCount
}

function objectExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'video/webm') return 'webm'
  if (mimeType === 'video/quicktime') return 'mov'
  return 'mp4'
}

function createStagingObjectKey(workspaceId: string, importId: string, asset: MigrationPackageAsset) {
  return `workspaces/${workspaceId}/migration-imports/${importId}/${asset.logicalAssetId}-${randomUUID()}.${objectExtension(asset.mimeType)}`
}

function activeImportStatus(status: string) {
  return status === 'prepared' || status === 'uploading' || status === 'validating' || status === 'ready'
}

function findManifestAsset(importRow: MigrationImportRow, logicalAssetId: string) {
  const asset = importRow.asset_manifest_json.assets.find((candidate) => candidate.logicalAssetId === logicalAssetId)
  if (!asset) {
    uploadNotFound()
  }
  return asset
}

async function findImport(
  client: Pick<DbClient, 'query'>,
  importId: string,
  workspaceId: string,
  forUpdate = false,
) {
  const result = await client.query<MigrationImportRow>(
    `
      SELECT id::text, status, expires_at, total_file_count, asset_count, asset_manifest_json
      FROM migration_imports
      WHERE id = $1 AND workspace_id = $2
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [importId, workspaceId],
  )
  return result.rows[0] ?? migrationImportNotFound()
}

async function findUpload(
  client: Pick<DbClient, 'query'>,
  importId: string,
  workspaceId: string,
  logicalAssetId: string,
  forUpdate = false,
) {
  const result = await client.query<MigrationAssetUploadRow>(
    `
      SELECT ${UPLOAD_COLUMNS}
      FROM migration_import_asset_uploads
      WHERE import_id = $1 AND workspace_id = $2 AND logical_asset_id = $3
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [importId, workspaceId, logicalAssetId],
  )
  return result.rows[0] ?? null
}

function mergePart(parts: CompletedPart[], next: CompletedPart) {
  const byNumber = new Map(parts.map((part) => [part.partNumber, part]))
  byNumber.set(next.partNumber, next)
  return [...byNumber.values()].sort((left, right) => left.partNumber - right.partNumber)
}

function sumParts(parts: CompletedPart[]) {
  return parts.reduce((total, part) => total + part.byteSize, 0)
}

function uploadResponseBase(row: MigrationAssetUploadRow): MigrationImportAssetUploadResponse['upload'] {
  return {
    id: row.id,
    importId: row.import_id,
    logicalAssetId: row.logical_asset_id,
    status: row.status,
    mode: row.upload_mode,
    expectedMimeType: row.expected_mime_type,
    expectedByteSize: toSafeInteger(row.expected_byte_size, 'expectedByteSize'),
    expectedSha256: row.expected_sha256,
    partSize: toSafeInteger(row.part_size, 'partSize'),
    partCount: row.part_count,
    completedParts: row.completed_parts_json.map((part) => part.partNumber).sort((a, b) => a - b),
    uploadedByteSize: toSafeInteger(row.uploaded_byte_size, 'uploadedByteSize'),
    retryCount: row.retry_count,
    directUpload: null,
    parts: [],
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

async function withStagingUrls(
  row: MigrationAssetUploadRow,
  objectStorage: MigrationImportObjectStorage,
) {
  const response = uploadResponseBase(row)
  if (row.status === 'completed' || row.status === 'canceled' || row.status === 'expired' || row.status === 'failed') {
    return { upload: response }
  }
  if (row.upload_mode === 'single') {
    const directUpload = await objectStorage.createPresignedUpload({
      objectKey: row.object_key,
      mimeType: row.expected_mime_type,
      byteSize: toSafeInteger(row.expected_byte_size, 'expectedByteSize'),
      expiresInSeconds: MIGRATION_ASSET_UPLOAD_URL_TTL_SECONDS,
    })
    if (directUpload.method !== 'PUT') {
      throw new Error('Migration staging uploads require a presigned PUT')
    }
    response.directUpload = { ...directUpload, method: 'PUT' }
    return { upload: response }
  }
  if (!row.provider_upload_id) {
    throw new Error('Multipart upload provider ID is missing')
  }
  const completed = new Set(row.completed_parts_json.map((part) => part.partNumber))
  const parts: MigrationImportAssetUploadPart[] = []
  for (let partNumber = 1; partNumber <= row.part_count; partNumber += 1) {
    if (completed.has(partNumber)) continue
    const signed = await objectStorage.createPresignedUploadPart({
      objectKey: row.object_key,
      uploadId: row.provider_upload_id,
      partNumber,
      byteSize: partByteSize(row, partNumber),
      expiresInSeconds: MIGRATION_ASSET_UPLOAD_URL_TTL_SECONDS,
    })
    parts.push({
      partNumber,
      byteSize: partByteSize(row, partNumber),
      ...signed,
    })
  }
  response.parts = parts
  return { upload: response }
}

async function assertObjectMatches(
  objectStorage: MigrationImportObjectStorage,
  row: MigrationAssetUploadRow,
) {
  let metadata: Awaited<ReturnType<MigrationImportObjectStorage['getObjectMetadata']>>
  try {
    metadata = await objectStorage.getObjectMetadata(row.object_key)
  } catch {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'ASSET_NOT_READY',
      message: 'Migration staging object is not available',
    })
  }
  const expectedByteSize = toSafeInteger(row.expected_byte_size, 'expectedByteSize')
  if (metadata.byteSize !== expectedByteSize) {
    uploadInvalid('Migration staging object size does not match the manifest', {
      expectedByteSize,
      actualByteSize: metadata.byteSize,
    })
  }
  const actualMimeType = metadata.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (actualMimeType !== row.expected_mime_type) {
    uploadInvalid('Migration staging object MIME type does not match the manifest')
  }
  const actualSha256 = await objectStorage.calculateObjectSha256(row.object_key)
  if (actualSha256 !== row.expected_sha256) {
    uploadInvalid('Migration staging object SHA-256 does not match the manifest')
  }
}

function validatePartInput(input: CompleteMigrationImportAssetUploadRequest, row: MigrationAssetUploadRow) {
  const parts = input.parts ?? {}
  const parsed = (Object.entries(parts) as Array<[string, { etag: string; byteSize: number }]>).map(([rawNumber, part]) => {
    const partNumber = Number(rawNumber)
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > row.part_count) {
      validationError('Part number is outside the upload range')
    }
    const expectedByteSize = partByteSize(row, partNumber)
    if (part.byteSize !== expectedByteSize) {
      validationError(`Part ${partNumber} byteSize does not match the upload plan`)
    }
    return { partNumber, etag: part.etag, byteSize: part.byteSize }
  })
  return parsed
}

export interface MigrationAssetUploadService {
  prepareAssetUpload: (importId: string, logicalAssetId: string, actor: ProjectActor) => Promise<MigrationImportAssetUploadResponse>
  getAssetUpload: (importId: string, logicalAssetId: string, actor: ProjectActor) => Promise<MigrationImportAssetUploadResponse>
  completeAssetPart: (
    importId: string,
    logicalAssetId: string,
    partNumber: number,
    input: unknown,
    actor: ProjectActor,
  ) => Promise<MigrationImportAssetUploadResponse>
  completeAssetUpload: (
    importId: string,
    logicalAssetId: string,
    input: unknown,
    actor: ProjectActor,
  ) => Promise<MigrationImportAssetUploadResponse>
  cancelAssetUpload: (importId: string, logicalAssetId: string, actor: ProjectActor) => Promise<MigrationImportAssetUploadResponse>
  maintainStagingObjects: (options?: { graceHours?: number; batchSize?: number }) => Promise<number>
}

export function createPostgresMigrationAssetUploadService(
  pool: DbPool,
  objectStorage: MigrationImportObjectStorage,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): MigrationAssetUploadService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)

  async function requireAccess(actor: ProjectActor, write = false) {
    return authorizationService.requireWorkspaceAccess({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      ...(write ? { allowedRoles: MIGRATION_IMPORT_WRITE_ROLES } : {}),
    })
  }

  async function prepareOrGet(rawImportId: string, rawLogicalAssetId: string, actor: ProjectActor) {
    await requireAccess(actor, true)
    const importId = normalizeMigrationImportId(rawImportId)
    const logicalAssetId = normalizeLogicalAssetId(rawLogicalAssetId)
    let row: MigrationAssetUploadRow | null = null
    let staleObject: { objectKey: string; providerUploadId: string | null } | null = null
    await withTransaction(pool, async (client) => {
      const importRow = await findImport(client, importId, actor.workspaceId, true)
      if (new Date(importRow.expires_at).getTime() <= Date.now() && activeImportStatus(importRow.status)) {
        await client.query(`UPDATE migration_imports SET status = 'expired', updated_at = now() WHERE id = $1`, [importId])
        importConflict('Migration import has expired')
      }
      if (!activeImportStatus(importRow.status)) {
        importConflict('Migration import is not accepting asset uploads')
      }
      const asset = findManifestAsset(importRow, logicalAssetId)
      row = await findUpload(client, importId, actor.workspaceId, logicalAssetId, true)
      if (row?.status === 'completed' || row?.status === 'canceled') {
        return
      }

      const expectedByteSize = asset.byteSize
      if (!row) {
        await lockWorkspaceStorageQuota(client, actor.workspaceId)
        assertWorkspaceStorageCapacity(await readWorkspaceStorageUsage(client, actor.workspaceId), expectedByteSize)
        const partCount = calculatePartCount(expectedByteSize)
        const uploadMode: MigrationImportAssetUploadMode = partCount > 1 ? 'multipart' : 'single'
        const objectKey = createStagingObjectKey(actor.workspaceId, importId, asset)
        let providerUploadId: string | null = null
        if (uploadMode === 'multipart') {
          providerUploadId = (await objectStorage.initiateMultipartUpload({
            objectKey,
            mimeType: asset.mimeType,
          })).uploadId
        }
        const result = await client.query<MigrationAssetUploadRow>(
          `
            INSERT INTO migration_import_asset_uploads (
              workspace_id, import_id, logical_asset_id, object_key, provider_upload_id,
              upload_mode, part_size, part_count, expected_file_path, expected_original_file_name,
              expected_mime_type, expected_byte_size, expected_sha256, expected_width, expected_height,
              expected_asset_kind, status, expires_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              'uploading', LEAST($17::timestamptz, now() + ($18 * interval '1 hour'))
            )
            RETURNING ${UPLOAD_COLUMNS}
          `,
          [
            actor.workspaceId,
            importId,
            asset.logicalAssetId,
            objectKey,
            providerUploadId,
            uploadMode,
            MIGRATION_ASSET_MULTIPART_PART_SIZE,
            partCount,
            asset.filePath,
            asset.originalFileName,
            asset.mimeType,
            asset.byteSize,
            asset.sha256,
            asset.width,
            asset.height,
            asset.assetKind,
            importRow.expires_at,
            MIGRATION_ASSET_UPLOAD_TTL_HOURS,
          ],
        )
        row = result.rows[0] ?? null
        await client.query(
          `UPDATE migration_imports SET status = 'uploading', updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status IN ('prepared', 'ready')`,
          [importId, actor.workspaceId],
        )
      } else if (
        row.status === 'failed'
        || row.status === 'expired'
        || new Date(row.expires_at).getTime() <= Date.now()
      ) {
        await lockWorkspaceStorageQuota(client, actor.workspaceId)
        assertWorkspaceStorageCapacity(await readWorkspaceStorageUsage(client, actor.workspaceId), expectedByteSize)
        staleObject = { objectKey: row.object_key, providerUploadId: row.provider_upload_id }
        const partCount = calculatePartCount(expectedByteSize)
        const uploadMode: MigrationImportAssetUploadMode = partCount > 1 ? 'multipart' : 'single'
        const objectKey = createStagingObjectKey(actor.workspaceId, importId, asset)
        const providerUploadId = uploadMode === 'multipart'
          ? (await objectStorage.initiateMultipartUpload({ objectKey, mimeType: asset.mimeType })).uploadId
          : null
        const result = await client.query<MigrationAssetUploadRow>(
          `UPDATE migration_import_asset_uploads
           SET object_key = $1, provider_upload_id = $2, upload_mode = $3,
               part_size = $4, part_count = $5, completed_parts_json = '[]'::jsonb,
               uploaded_byte_size = 0, status = 'uploading', error_code = NULL, error_message = NULL,
               expires_at = LEAST($6::timestamptz, now() + ($7 * interval '1 hour')), completed_at = NULL, canceled_at = NULL,
               updated_at = now()
           WHERE id = $8 AND workspace_id = $9
           RETURNING ${UPLOAD_COLUMNS}`,
          [
            objectKey,
            providerUploadId,
            uploadMode,
            MIGRATION_ASSET_MULTIPART_PART_SIZE,
            partCount,
            importRow.expires_at,
            MIGRATION_ASSET_UPLOAD_TTL_HOURS,
            row.id,
            actor.workspaceId,
          ],
        )
        row = result.rows[0] ?? row
        await client.query(
          `UPDATE migration_imports SET status = 'uploading', updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status IN ('prepared', 'ready')`,
          [importId, actor.workspaceId],
        )
      }
    })

    if (!row) {
      uploadNotFound()
    }
    const objectToCleanup = staleObject as unknown as { objectKey: string; providerUploadId: string | null } | null
    if (objectToCleanup) {
      if (objectToCleanup.providerUploadId) {
        await objectStorage.abortMultipartUpload({
          objectKey: objectToCleanup.objectKey,
          uploadId: objectToCleanup.providerUploadId,
        }).catch(() => undefined)
      }
      await objectStorage.deleteObject(objectToCleanup.objectKey).catch(() => undefined)
    }
    const preparedRow = row
    if (!preparedRow) uploadNotFound()
    return withStagingUrls(preparedRow, objectStorage)
  }

  async function getUpload(rawImportId: string, rawLogicalAssetId: string, actor: ProjectActor) {
    await requireAccess(actor)
    const importId = normalizeMigrationImportId(rawImportId)
    const logicalAssetId = normalizeLogicalAssetId(rawLogicalAssetId)
    const row = await withTransaction(pool, async (client) => {
      const importRow = await findImport(client, importId, actor.workspaceId, true)
      if (new Date(importRow.expires_at).getTime() <= Date.now() && activeImportStatus(importRow.status)) {
        await client.query(`UPDATE migration_imports SET status = 'expired', updated_at = now() WHERE id = $1`, [importId])
        await client.query(
          `UPDATE migration_import_asset_uploads
           SET status = 'expired', updated_at = now()
           WHERE import_id = $1 AND workspace_id = $2 AND status IN ('pending', 'uploading', 'validating')`,
          [importId, actor.workspaceId],
        )
      }
      const current = await findUpload(client, importId, actor.workspaceId, logicalAssetId, true)
      if (current && ['pending', 'uploading', 'validating'].includes(current.status)
        && new Date(current.expires_at).getTime() <= Date.now()) {
        const expired = await client.query<MigrationAssetUploadRow>(
          `UPDATE migration_import_asset_uploads SET status = 'expired', updated_at = now()
           WHERE id = $1 AND workspace_id = $2 RETURNING ${UPLOAD_COLUMNS}`,
          [current.id, actor.workspaceId],
        )
        return expired.rows[0] ?? current
      }
      return current
    })
    if (!row) uploadNotFound()
    const recordedRow = row
    if (!recordedRow) uploadNotFound()
    return withStagingUrls(recordedRow, objectStorage)
  }

  async function recordPart(
    rawImportId: string,
    rawLogicalAssetId: string,
    rawPartNumber: number,
    rawInput: unknown,
    actor: ProjectActor,
  ) {
    await requireAccess(actor, true)
    const importId = normalizeMigrationImportId(rawImportId)
    const logicalAssetId = normalizeLogicalAssetId(rawLogicalAssetId)
    if (!Number.isSafeInteger(rawPartNumber) || rawPartNumber < 1) validationError('partNumber must be a positive safe integer')
    const input = validateCompleteMigrationImportAssetUploadRequest({ parts: { [rawPartNumber]: rawInput } })
    const partInput = input.parts?.[String(rawPartNumber)]
    if (!partInput) validationError('Part completion payload is required')
    const part = { partNumber: rawPartNumber, etag: partInput.etag, byteSize: partInput.byteSize }
    let row: MigrationAssetUploadRow | null = null
    await withTransaction(pool, async (client) => {
      const importRow = await findImport(client, importId, actor.workspaceId, true)
      if (!activeImportStatus(importRow.status)) importConflict('Migration import is not accepting asset uploads')
      row = await findUpload(client, importId, actor.workspaceId, logicalAssetId, true)
      if (!row) uploadNotFound()
      if (row.upload_mode !== 'multipart') validationError('Single-part uploads do not accept part completion')
      if (row.status !== 'uploading' && row.status !== 'pending') importConflict('Migration asset upload is not active')
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE migration_import_asset_uploads SET status = 'expired', updated_at = now() WHERE id = $1`,
          [row.id],
        )
        importConflict('Migration asset upload has expired')
      }
      const expectedByteSize = partByteSize(row, rawPartNumber)
      if (part.byteSize !== expectedByteSize) validationError('Part byteSize does not match the upload plan')
      const merged = mergePart(row.completed_parts_json, part)
      const uploadedByteSize = sumParts(merged)
      if (uploadedByteSize > toSafeInteger(row.expected_byte_size, 'expectedByteSize')) {
        validationError('Completed parts exceed the expected asset size')
      }
      const result = await client.query<MigrationAssetUploadRow>(
        `UPDATE migration_import_asset_uploads
         SET completed_parts_json = $1::jsonb, uploaded_byte_size = $2, status = 'uploading', updated_at = now()
         WHERE id = $3 AND workspace_id = $4
         RETURNING ${UPLOAD_COLUMNS}`,
        [JSON.stringify(merged), uploadedByteSize, row.id, actor.workspaceId],
      )
      row = result.rows[0] ?? row
    })
    const recordedRow = row
    if (!recordedRow) uploadNotFound()
    return withStagingUrls(recordedRow, objectStorage)
  }

  async function completeUpload(rawImportId: string, rawLogicalAssetId: string, rawInput: unknown, actor: ProjectActor) {
    await requireAccess(actor, true)
    const importId = normalizeMigrationImportId(rawImportId)
    const logicalAssetId = normalizeLogicalAssetId(rawLogicalAssetId)
    const input = validateCompleteMigrationImportAssetUploadRequest(rawInput)
    let row: MigrationAssetUploadRow | null = null
    let parts: CompletedPart[] = []
    let alreadyCompleted = false
    await withTransaction(pool, async (client) => {
      const importRow = await findImport(client, importId, actor.workspaceId, true)
      if (!activeImportStatus(importRow.status)) importConflict('Migration import is not accepting asset uploads')
      row = await findUpload(client, importId, actor.workspaceId, logicalAssetId, true)
      if (!row) uploadNotFound()
      if (row.status === 'completed') {
        alreadyCompleted = true
        return
      }
      if (row.status === 'canceled' || row.status === 'expired' || row.status === 'failed') importConflict('Migration asset upload is not active')
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE migration_import_asset_uploads SET status = 'expired', updated_at = now() WHERE id = $1`,
          [row.id],
        )
        importConflict('Migration asset upload has expired')
      }
      const providedParts = validatePartInput(input, row)
      parts = providedParts.reduce(
        (merged, part) => mergePart(merged, part),
        row.completed_parts_json,
      )
      if (row.upload_mode === 'multipart') {
        if (parts.length !== row.part_count || parts.some((part, index) => part.partNumber !== index + 1)) {
          importConflict('All multipart upload parts must be completed before finalization')
        }
      }
      const result = await client.query<MigrationAssetUploadRow>(
        `UPDATE migration_import_asset_uploads SET status = 'validating', updated_at = now()
         WHERE id = $1 AND workspace_id = $2 RETURNING ${UPLOAD_COLUMNS}`,
        [row.id, actor.workspaceId],
      )
      row = result.rows[0] ?? row
    })
    const validatingRow = row as unknown as MigrationAssetUploadRow
    if (alreadyCompleted) {
      return withStagingUrls(validatingRow, objectStorage)
    }

    try {
      if (validatingRow.upload_mode === 'multipart') {
        if (!validatingRow.provider_upload_id) throw new Error('Multipart provider upload ID is missing')
        await objectStorage.completeMultipartUpload({
          objectKey: validatingRow.object_key,
          uploadId: validatingRow.provider_upload_id,
          parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
        })
      }
      await assertObjectMatches(objectStorage, validatingRow)
    } catch (error) {
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE migration_import_asset_uploads
           SET status = 'failed', error_code = $1, error_message = $2, retry_count = retry_count + 1, updated_at = now()
           WHERE id = $3 AND workspace_id = $4`,
          ['ASSET_VALIDATION_FAILED', 'Migration staging object validation failed', validatingRow.id, actor.workspaceId],
        )
      })
      if (validatingRow.upload_mode === 'multipart' && validatingRow.provider_upload_id) {
        await objectStorage.abortMultipartUpload({ objectKey: validatingRow.object_key, uploadId: validatingRow.provider_upload_id }).catch(() => undefined)
      }
      await objectStorage.deleteObject(validatingRow.object_key).catch(() => undefined)
      if (error instanceof AuthServiceError) throw error
      uploadInvalid('Migration staging object validation failed')
    }

    const completed = await withTransaction(pool, async (client) => {
      const result = await client.query<MigrationAssetUploadRow>(
        `UPDATE migration_import_asset_uploads
         SET status = 'completed', completed_at = COALESCE(completed_at, now()), uploaded_byte_size = expected_byte_size,
             error_code = NULL, error_message = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = $2 RETURNING ${UPLOAD_COLUMNS}`,
        [validatingRow.id, actor.workspaceId],
      )
      await client.query(
        `
          UPDATE migration_imports mi
          SET completed_file_count = (mi.total_file_count - mi.asset_count) + (
                SELECT count(*) FROM migration_import_asset_uploads miau
                WHERE miau.import_id = mi.id AND miau.workspace_id = mi.workspace_id AND miau.status = 'completed'
              ),
              completed_bytes = COALESCE((
                SELECT sum(miau.expected_byte_size) FROM migration_import_asset_uploads miau
                WHERE miau.import_id = mi.id AND miau.workspace_id = mi.workspace_id AND miau.status = 'completed'
              ), 0),
              status = CASE WHEN (
                SELECT count(*) FROM migration_import_asset_uploads miau
                WHERE miau.import_id = mi.id AND miau.workspace_id = mi.workspace_id AND miau.status = 'completed'
              ) >= mi.asset_count THEN 'ready' ELSE 'uploading' END,
              updated_at = now()
          WHERE mi.id = $1 AND mi.workspace_id = $2
        `,
        [importId, actor.workspaceId],
      )
      return result.rows[0] ?? null
    })
    if (!completed) uploadNotFound()
    return withStagingUrls(completed, objectStorage)
  }

  async function cancelUpload(rawImportId: string, rawLogicalAssetId: string, actor: ProjectActor) {
    await requireAccess(actor, true)
    const importId = normalizeMigrationImportId(rawImportId)
    const logicalAssetId = normalizeLogicalAssetId(rawLogicalAssetId)
    const result = await withTransaction(pool, async (client) => {
      const importRow = await findImport(client, importId, actor.workspaceId, true)
      if (importRow.status === 'completed') importConflict('Completed migration import cannot cancel asset uploads')
      const current = await findUpload(client, importId, actor.workspaceId, logicalAssetId, true)
      if (!current) uploadNotFound()
      if (current.status === 'completed' || current.status === 'canceled' || current.status === 'expired' || current.status === 'failed') {
        return { row: current, shouldCleanup: false }
      }
      const result = await client.query<MigrationAssetUploadRow>(
        `UPDATE migration_import_asset_uploads
         SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
         WHERE id = $1 AND workspace_id = $2 RETURNING ${UPLOAD_COLUMNS}`,
        [current.id, actor.workspaceId],
      )
      return { row: result.rows[0] ?? current, shouldCleanup: true }
    })
    const row = result.row
    if (result.shouldCleanup && row.provider_upload_id) {
      await objectStorage.abortMultipartUpload({ objectKey: row.object_key, uploadId: row.provider_upload_id }).catch(() => undefined)
    }
    if (result.shouldCleanup) {
      await objectStorage.deleteObject(row.object_key).catch(() => undefined)
    }
    return withStagingUrls(row, objectStorage)
  }

  async function maintainStagingObjects(options: { graceHours?: number; batchSize?: number } = {}) {
    const graceHours = options.graceHours ?? 24
    const batchSize = options.batchSize ?? 100
    if (!Number.isInteger(graceHours) || graceHours < 1 || graceHours > 8760 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new AuthServiceError({ statusCode: 400, apiCode: 'VALIDATION_FAILED', message: 'Invalid migration staging maintenance options' })
    }
    await pool.query(`
      UPDATE migration_imports
      SET status = 'expired', updated_at = now()
      WHERE expires_at <= now() AND status IN ('prepared', 'uploading', 'validating', 'ready')
    `)
    await pool.query(`
      UPDATE migration_import_asset_uploads
      SET status = 'expired', updated_at = now()
      WHERE expires_at <= now() AND status IN ('pending', 'uploading', 'validating')
    `)
    const stale = await pool.query<{ object_key: string; provider_upload_id: string | null }>(
      `
        SELECT u.object_key, u.provider_upload_id
        FROM migration_import_asset_uploads u
        JOIN migration_imports i ON i.workspace_id = u.workspace_id AND i.id = u.import_id
        WHERE u.committed_asset_id IS NULL
          AND u.updated_at < now() - ($1 * interval '1 hour')
          AND (
            u.status IN ('failed', 'canceled', 'expired')
            OR (u.status = 'completed' AND i.status IN ('failed', 'canceled', 'expired'))
          )
        ORDER BY u.updated_at, u.id
        LIMIT $2
      `,
      [graceHours, batchSize],
    )
    for (const row of stale.rows) {
      if (row.provider_upload_id) {
        await objectStorage.abortMultipartUpload({ objectKey: row.object_key, uploadId: row.provider_upload_id }).catch(() => undefined)
      }
      await objectStorage.deleteObject(row.object_key).catch(() => undefined)
    }
    return stale.rows.length
  }

  return {
    prepareAssetUpload: prepareOrGet,
    getAssetUpload: getUpload,
    completeAssetPart: recordPart,
    completeAssetUpload: completeUpload,
    cancelAssetUpload: cancelUpload,
    maintainStagingObjects,
  }
}

export function createUnavailableMigrationAssetUploadService(): MigrationAssetUploadService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Migration asset upload service is not configured',
      retryable: true,
    })
  }
  return {
    async prepareAssetUpload() { return unavailable() },
    async getAssetUpload() { return unavailable() },
    async completeAssetPart() { return unavailable() },
    async completeAssetUpload() { return unavailable() },
    async cancelAssetUpload() { return unavailable() },
    async maintainStagingObjects() { return unavailable() },
  }
}
