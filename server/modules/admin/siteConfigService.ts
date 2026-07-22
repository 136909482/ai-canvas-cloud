import { createHash, randomUUID } from 'node:crypto'
import type {
  AdminSiteConfigResponse,
  CreateSiteAssetRequest,
  PublicSiteAsset,
  PublicSiteConfigResponse,
  PublishSiteConfigRequest,
  SiteAssetResponse,
  SiteAssetStatus,
  SiteAssetSummary,
  SiteAssetsResponse,
  SiteAssetUploadResponse,
  SiteConfigDocument,
} from '@ai-canvas-cloud/contracts'
import { DEFAULT_SITE_CONFIG, validateSiteConfigDocument } from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { withTransaction } from '../../db/postgres.js'
import { insertAdminAuditEvent } from './adminAudit.js'
import { AdminAccessError } from './security.js'
import type { AdminService } from './service.js'
import type { AdminRequestContext } from './types.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon'])
const MAX_SITE_ASSET_BYTES = 4 * 1024 * 1024
const MAX_DIMENSION = 4096
const UPLOAD_TTL_SECONDS = 15 * 60
const READ_TTL_SECONDS = 5 * 60

export interface SiteAssetObjectStorage {
  createPresignedUpload(input: {
    objectKey: string
    mimeType: string
    byteSize: number
    expiresInSeconds: number
  }): Promise<SiteAssetUploadResponse['directUpload']>
  createPresignedDownload(input: {
    objectKey: string
    expiresInSeconds: number
  }): Promise<{ url: string; expiresAt: string }>
  getObjectMetadata(objectKey: string): Promise<{ byteSize: number; mimeType: string | null }>
  getObjectBytes(input: { objectKey: string; maxBytes: number }): Promise<Uint8Array>
}

export interface AdminSiteConfigService {
  getCurrent(context: AdminRequestContext): Promise<AdminSiteConfigResponse>
  publish(input: PublishSiteConfigRequest, context: AdminRequestContext): Promise<AdminSiteConfigResponse>
  listAssets(context: AdminRequestContext): Promise<SiteAssetsResponse>
  createAsset(input: CreateSiteAssetRequest, context: AdminRequestContext): Promise<SiteAssetUploadResponse>
  completeAsset(assetId: string, context: AdminRequestContext): Promise<SiteAssetResponse>
}

export interface PublicSiteConfigService {
  getCurrent(): Promise<PublicSiteConfigResponse>
}

interface SiteAssetRow {
  id: string
  asset_kind: 'logo' | 'favicon'
  object_key: string
  original_file_name: string
  mime_type: string
  byte_size: string | number
  sha256: string
  width: number
  height: number
  status: SiteAssetStatus
  idempotency_key: string
  request_fingerprint: string
  upload_expires_at: Date | string
  created_at: Date | string
  completed_at: Date | string | null
}

interface SiteConfigRow {
  revision_id: string
  config_json: unknown
  note: string | null
  created_by_admin_id: string
  created_at: Date | string
  etag: string
  logo_asset_id: string | null
  logo_object_key: string | null
  logo_mime_type: string | null
  favicon_asset_id: string | null
  favicon_object_key: string | null
  favicon_mime_type: string | null
}

interface PublicationRow {
  etag: string
  config_json: unknown
  logo_asset_id: string | null
  logo_object_key: string | null
  logo_mime_type: string | null
  favicon_asset_id: string | null
  favicon_object_key: string | null
  favicon_mime_type: string | null
}

function validationError(message: string) {
  return new AdminAccessError(400, 'VALIDATION_FAILED', message)
}

function validateUuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) throw validationError(`${field} is invalid`)
  return value.toLowerCase()
}

function validateAssetRequest(input: CreateSiteAssetRequest) {
  if (!input || typeof input !== 'object') throw validationError('Site asset request is invalid')
  if (input.kind !== 'logo' && input.kind !== 'favicon') throw validationError('Site asset kind is invalid')
  const originalFileName = input.originalFileName?.trim()
  if (!originalFileName || originalFileName.length > 255 || /[\\/\0]/.test(originalFileName)) {
    throw validationError('Site asset file name is invalid')
  }
  const mimeType = input.mimeType?.trim().toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw validationError('Site asset MIME type is invalid')
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_SITE_ASSET_BYTES) {
    throw validationError('Site asset byte size is invalid')
  }
  const sha256 = input.sha256?.trim().toLowerCase()
  if (!SHA256_PATTERN.test(sha256)) throw validationError('Site asset SHA-256 is invalid')
  if (!Number.isInteger(input.width) || input.width < 1 || input.width > MAX_DIMENSION
    || !Number.isInteger(input.height) || input.height < 1 || input.height > MAX_DIMENSION) {
    throw validationError('Site asset dimensions are invalid')
  }
  const idempotencyKey = input.idempotencyKey?.trim()
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw validationError('Site asset idempotency key is invalid')
  return { ...input, originalFileName, mimeType, sha256, idempotencyKey }
}

function validatePublishRequest(input: PublishSiteConfigRequest) {
  let config: SiteConfigDocument
  try { config = validateSiteConfigDocument(input?.config) } catch { throw validationError('Site configuration is invalid') }
  const note = input.note?.trim() || null
  if (note && note.length > 500) throw validationError('Site configuration note is too long')
  return { config, note }
}

function requestFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function etagForConfig(config: SiteConfigDocument) {
  return `"${createHash('sha256').update(JSON.stringify(config)).digest('hex')}"`
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'ico'
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

export function inspectSiteImage(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) throw validationError('PNG signature is invalid')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (mimeType === 'image/x-icon') {
    if (bytes.length < 22 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1 || bytes[3] !== 0) {
      throw validationError('ICO signature is invalid')
    }
    return { width: bytes[6] || 256, height: bytes[7] || 256 }
  }
  if (mimeType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw validationError('JPEG signature is invalid')
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]!
      if (marker === 0xd9 || marker === 0xda) break
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
      if (length < 2 || offset + length + 2 > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
        }
      }
      offset += length + 2
    }
    throw validationError('JPEG dimensions are missing')
  }
  if (bytes.length < 30 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') throw validationError('WebP signature is invalid')
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  if (chunk === 'VP8X') return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8)),
      height: 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)),
    }
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
  }
  throw validationError('WebP dimensions are missing')
}

function toAssetSummary(row: SiteAssetRow, signed?: { url: string; expiresAt: string } | null): SiteAssetSummary {
  return {
    id: row.id,
    kind: row.asset_kind,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    status: row.status,
    url: signed?.url ?? null,
    urlExpiresAt: signed?.expiresAt ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  }
}

async function signedPublicAsset(
  storage: SiteAssetObjectStorage,
  assetId: string | null,
  objectKey: string | null,
  mimeType: string | null,
): Promise<PublicSiteAsset | null> {
  if (!assetId || !objectKey || !mimeType) return null
  const signed = await storage.createPresignedDownload({ objectKey, expiresInSeconds: READ_TTL_SECONDS })
  return { assetId, mimeType, url: signed.url, expiresAt: signed.expiresAt }
}

async function publicResponse(storage: SiteAssetObjectStorage, row: PublicationRow | null): Promise<PublicSiteConfigResponse> {
  const config = row ? validateSiteConfigDocument(row.config_json) : DEFAULT_SITE_CONFIG
  return {
    etag: row?.etag ?? etagForConfig(config),
    config,
    assets: {
      logo: row ? await signedPublicAsset(storage, row.logo_asset_id, row.logo_object_key, row.logo_mime_type) : null,
      favicon: row ? await signedPublicAsset(storage, row.favicon_asset_id, row.favicon_object_key, row.favicon_mime_type) : null,
    },
  }
}

async function findAsset(database: Pick<DbPool | DbClient, 'query'>, assetId: string, lock = false) {
  const result = await database.query<SiteAssetRow>(`
    SELECT id::text, asset_kind, object_key, original_file_name, mime_type, byte_size,
           sha256, width, height, status, idempotency_key, request_fingerprint,
           upload_expires_at, created_at, completed_at
    FROM site_assets
    WHERE id = $1 AND status <> 'deleted'
    ${lock ? 'FOR UPDATE' : ''}
  `, [assetId])
  return result.rows[0] ?? null
}

async function resolveConfigAsset(client: DbClient, assetId: string | null, kind: 'logo' | 'favicon') {
  if (!assetId) return null
  const row = await findAsset(client, validateUuid(assetId, `${kind}AssetId`), false)
  if (!row || row.status !== 'completed' || row.asset_kind !== kind) throw validationError(`${kind} asset is not ready`)
  return row
}

export function createPostgresAdminSiteConfigService(
  pool: DbPool,
  options: {
    adminService: AdminService
    objectStorage: SiteAssetObjectStorage
    auditSecret: string
  },
): AdminSiteConfigService {
  async function signedSummary(row: SiteAssetRow) {
    const signed = row.status === 'completed'
      ? await options.objectStorage.createPresignedDownload({ objectKey: row.object_key, expiresInSeconds: READ_TTL_SECONDS })
      : null
    return toAssetSummary(row, signed)
  }

  return {
    async getCurrent(context) {
      await options.adminService.requirePermission(context, 'site_config.write')
      const result = await pool.query<SiteConfigRow>(`
        SELECT r.id::text AS revision_id, r.config_json, r.note, r.created_by_admin_id,
               r.created_at, p.etag, p.logo_asset_id::text, p.logo_object_key, p.logo_mime_type,
               p.favicon_asset_id::text, p.favicon_object_key, p.favicon_mime_type
        FROM site_config_current c
        JOIN site_config_revisions r ON r.id = c.revision_id
        JOIN public.site_config_publications p ON p.revision_id = r.id
        WHERE c.singleton_id = 1
      `)
      const row = result.rows[0]
      if (!row) {
        const fallback = await publicResponse(options.objectStorage, null)
        return { ...fallback, revision: null }
      }
      const published = await publicResponse(options.objectStorage, row)
      return {
        ...published,
        revision: {
          id: row.revision_id,
          note: row.note,
          createdByAdminId: row.created_by_admin_id,
          createdAt: new Date(row.created_at).toISOString(),
        },
      }
    },

    async publish(input, context) {
      const session = await options.adminService.requirePermission(context, 'site_config.write')
      const request = validatePublishRequest(input)
      const revisionId = randomUUID()
      const etag = etagForConfig(request.config)
      await withTransaction(pool, async (client) => {
        const logo = await resolveConfigAsset(client, request.config.logoAssetId, 'logo')
        const favicon = await resolveConfigAsset(client, request.config.faviconAssetId, 'favicon')
        await client.query(`
          INSERT INTO site_config_revisions (id, schema_version, config_json, note, created_by_admin_id)
          VALUES ($1, 1, $2::jsonb, $3, $4)
        `, [revisionId, JSON.stringify(request.config), request.note, session.admin.id])
        await client.query(`
          INSERT INTO site_config_current (singleton_id, revision_id, updated_by_admin_id)
          VALUES (1, $1, $2)
          ON CONFLICT (singleton_id) DO UPDATE
          SET revision_id = EXCLUDED.revision_id,
              updated_by_admin_id = EXCLUDED.updated_by_admin_id,
              updated_at = now()
        `, [revisionId, session.admin.id])
        await client.query(`
          INSERT INTO public.site_config_publications (
            singleton_id, revision_id, etag, config_json,
            logo_asset_id, logo_object_key, logo_mime_type,
            favicon_asset_id, favicon_object_key, favicon_mime_type
          ) VALUES (1, $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (singleton_id) DO UPDATE
          SET revision_id = EXCLUDED.revision_id,
              etag = EXCLUDED.etag,
              config_json = EXCLUDED.config_json,
              logo_asset_id = EXCLUDED.logo_asset_id,
              logo_object_key = EXCLUDED.logo_object_key,
              logo_mime_type = EXCLUDED.logo_mime_type,
              favicon_asset_id = EXCLUDED.favicon_asset_id,
              favicon_object_key = EXCLUDED.favicon_object_key,
              favicon_mime_type = EXCLUDED.favicon_mime_type,
              published_at = now()
        `, [revisionId, etag, JSON.stringify(request.config), logo?.id ?? null, logo?.object_key ?? null, logo?.mime_type ?? null, favicon?.id ?? null, favicon?.object_key ?? null, favicon?.mime_type ?? null])
        await insertAdminAuditEvent(client, {
          actor: session.admin,
          action: 'admin.site_config.published',
          targetType: 'site_config_revision',
          targetId: revisionId,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after: { revisionId, schemaVersion: 1, themePreset: request.config.themePreset },
        }, options.auditSecret)
      })
      return this.getCurrent(context)
    },

    async listAssets(context) {
      await options.adminService.requirePermission(context, 'site_config.write')
      const result = await pool.query<SiteAssetRow>(`
        SELECT id::text, asset_kind, object_key, original_file_name, mime_type, byte_size,
               sha256, width, height, status, idempotency_key, request_fingerprint,
               upload_expires_at, created_at, completed_at
        FROM site_assets
        WHERE status <> 'deleted'
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `)
      return { items: await Promise.all(result.rows.map(signedSummary)) }
    },

    async createAsset(input, context) {
      const session = await options.adminService.requirePermission(context, 'site_config.write')
      const request = validateAssetRequest(input)
      const fingerprint = requestFingerprint(request)
      const assetId = randomUUID()
      const objectKey = `site-assets/${assetId}.${extensionForMime(request.mimeType)}`
      const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000)
      const row = await withTransaction(pool, async (client) => {
        const existing = await client.query<SiteAssetRow>(`
          SELECT id::text, asset_kind, object_key, original_file_name, mime_type, byte_size,
                 sha256, width, height, status, idempotency_key, request_fingerprint,
                 upload_expires_at, created_at, completed_at
          FROM site_assets
          WHERE uploaded_by_admin_id = $1 AND idempotency_key = $2
          FOR UPDATE
        `, [session.admin.id, request.idempotencyKey])
        if (existing.rows[0]) {
          if (existing.rows[0].request_fingerprint !== fingerprint) throw new AdminAccessError(409, 'VALIDATION_FAILED', 'Site asset idempotency key was reused')
          return existing.rows[0]
        }
        const inserted = await client.query<SiteAssetRow>(`
          INSERT INTO site_assets (
            id, asset_kind, object_key, original_file_name, mime_type, byte_size, sha256,
            width, height, idempotency_key, request_fingerprint, uploaded_by_admin_id, upload_expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id::text, asset_kind, object_key, original_file_name, mime_type, byte_size,
                    sha256, width, height, status, idempotency_key, request_fingerprint,
                    upload_expires_at, created_at, completed_at
        `, [assetId, request.kind, objectKey, request.originalFileName, request.mimeType, request.byteSize, request.sha256, request.width, request.height, request.idempotencyKey, fingerprint, session.admin.id, expiresAt])
        await insertAdminAuditEvent(client, {
          actor: session.admin,
          action: 'admin.site_asset.upload_created',
          targetType: 'site_asset',
          targetId: assetId,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after: { kind: request.kind, mimeType: request.mimeType, byteSize: request.byteSize },
        }, options.auditSecret)
        return inserted.rows[0]!
      })
      return {
        asset: await signedSummary(row),
        directUpload: await options.objectStorage.createPresignedUpload({
          objectKey: row.object_key,
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size),
          expiresInSeconds: UPLOAD_TTL_SECONDS,
        }),
      }
    },

    async completeAsset(assetId, context) {
      const session = await options.adminService.requirePermission(context, 'site_config.write')
      const normalizedAssetId = validateUuid(assetId, 'assetId')
      const candidate = await findAsset(pool, normalizedAssetId)
      if (!candidate) throw new AdminAccessError(404, 'VALIDATION_FAILED', 'Site asset was not found')
      if (candidate.status === 'completed') return { asset: await signedSummary(candidate) }
      if (candidate.status !== 'pending' || new Date(candidate.upload_expires_at).getTime() <= Date.now()) {
        throw new AdminAccessError(409, 'VALIDATION_FAILED', 'Site asset upload is not pending')
      }
      const metadata = await options.objectStorage.getObjectMetadata(candidate.object_key)
      if (metadata.byteSize !== Number(candidate.byte_size) || metadata.mimeType?.toLowerCase() !== candidate.mime_type) {
        throw new AdminAccessError(422, 'VALIDATION_FAILED', 'Site asset metadata does not match the upload request')
      }
      const bytes = await options.objectStorage.getObjectBytes({ objectKey: candidate.object_key, maxBytes: MAX_SITE_ASSET_BYTES })
      const actualSha256 = createHash('sha256').update(bytes).digest('hex')
      const dimensions = inspectSiteImage(bytes, candidate.mime_type)
      if (actualSha256 !== candidate.sha256 || dimensions.width !== candidate.width || dimensions.height !== candidate.height
        || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
        throw new AdminAccessError(422, 'VALIDATION_FAILED', 'Site asset content does not match the upload request')
      }
      const completed = await withTransaction(pool, async (client) => {
        const locked = await findAsset(client, normalizedAssetId, true)
        if (!locked) throw new AdminAccessError(404, 'VALIDATION_FAILED', 'Site asset was not found')
        if (locked.status === 'completed') return locked
        if (locked.status !== 'pending') throw new AdminAccessError(409, 'VALIDATION_FAILED', 'Site asset upload is not pending')
        const result = await client.query<SiteAssetRow>(`
          UPDATE site_assets
          SET status = 'completed', completed_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING id::text, asset_kind, object_key, original_file_name, mime_type, byte_size,
                    sha256, width, height, status, idempotency_key, request_fingerprint,
                    upload_expires_at, created_at, completed_at
        `, [normalizedAssetId])
        await insertAdminAuditEvent(client, {
          actor: session.admin,
          action: 'admin.site_asset.completed',
          targetType: 'site_asset',
          targetId: normalizedAssetId,
          result: 'success',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after: { kind: locked.asset_kind, mimeType: locked.mime_type, byteSize: Number(locked.byte_size) },
        }, options.auditSecret)
        return result.rows[0]!
      })
      return { asset: await signedSummary(completed) }
    },
  }
}

export function createPostgresPublicSiteConfigService(
  pool: DbPool,
  objectStorage: SiteAssetObjectStorage,
): PublicSiteConfigService {
  return {
    async getCurrent() {
      const result = await pool.query<PublicationRow>(`
        SELECT etag, config_json, logo_asset_id::text, logo_object_key, logo_mime_type,
               favicon_asset_id::text, favicon_object_key, favicon_mime_type
        FROM site_config_publications
        WHERE singleton_id = 1
      `)
      return publicResponse(objectStorage, result.rows[0] ?? null)
    },
  }
}

export function createUnavailableAdminSiteConfigService(): AdminSiteConfigService {
  const unavailable = async (): Promise<never> => { throw new AdminAccessError(503, 'SERVICE_UNAVAILABLE', 'Site configuration service is unavailable') }
  return { getCurrent: unavailable, publish: unavailable, listAssets: unavailable, createAsset: unavailable, completeAsset: unavailable }
}

export function createUnavailablePublicSiteConfigService(): PublicSiteConfigService {
  return { async getCurrent() { return publicResponse({} as SiteAssetObjectStorage, null) } }
}
