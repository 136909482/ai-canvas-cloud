import type {
  AssetKind,
  AssetReferenceRole,
  AssetUploadResponse,
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
} from '@ai-canvas-cloud/contracts'
import type {
  WorkspaceAssetWriteResult,
  WriteWorkspaceAssetInput,
} from '@/platform/types'
import { createCloudAssetRelativePath } from './cloudAssetUrlCache.ts'

interface CloudAssetUploaderOptions {
  createUpload: (input: CreateAssetUploadRequest) => Promise<AssetUploadResponse>
  completeUpload: (uploadId: string) => Promise<CompleteAssetUploadResponse>
  fetchDirectUpload?: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>
  createId?: () => string
  now?: () => number
}

interface CloudAssetWriteDescriptor {
  projectId: string | null
  assetKind: AssetKind
  referenceRole: AssetReferenceRole
}

const PATH_ASSET_KINDS: Record<string, AssetKind> = {
  uploads: 'upload',
  migrated: 'upload',
  generated: 'generated',
  edits: 'edit',
  crops: 'crop',
  thumbnails: 'thumbnail',
  previews: 'preview',
  videos: 'video',
}

const ASSET_REFERENCE_ROLES: Record<AssetKind, AssetReferenceRole> = {
  upload: 'source',
  generated: 'result',
  edit: 'result',
  crop: 'result',
  thumbnail: 'thumbnail',
  preview: 'preview',
  video: 'source',
}

const FILE_EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

function normalizePathSegments(pathSegments: string[]) {
  return pathSegments.map((segment) => segment.trim()).filter(Boolean)
}

function inferMimeType(blob: Blob, fileName: string) {
  if (blob.type.trim()) {
    return blob.type.trim().toLowerCase()
  }

  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILE_EXTENSION_MIME_TYPES[extension] ?? 'application/octet-stream'
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function describeCloudAssetWrite(input: WriteWorkspaceAssetInput): CloudAssetWriteDescriptor {
  const segments = normalizePathSegments(input.pathSegments)
  const projectRootIndex = segments.indexOf('projects')
  const inferredProjectId = projectRootIndex >= 0 ? segments[projectRootIndex + 1] ?? null : null
  const category = projectRootIndex >= 0
    ? segments[projectRootIndex + 2] ?? ''
    : segments[0] ?? ''
  let assetKind = input.assetKind ?? PATH_ASSET_KINDS[category] ?? 'upload'

  if (
    input.assetKind === undefined
    && assetKind === 'upload'
    && inferMimeType(input.blob, input.fileName).startsWith('video/')
  ) {
    assetKind = 'video'
  }

  return {
    projectId: input.projectId === undefined ? inferredProjectId : input.projectId,
    assetKind,
    referenceRole: input.referenceRole ?? ASSET_REFERENCE_ROLES[assetKind],
  }
}

export function createCloudAssetUploader(options: CloudAssetUploaderOptions) {
  const fetchDirectUpload = options.fetchDirectUpload ?? ((url, init) => fetch(url, init))
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now

  return {
    async upload(input: WriteWorkspaceAssetInput): Promise<WorkspaceAssetWriteResult> {
      if (input.blob.size < 1) {
        throw new Error('不能上传空资产')
      }

      const descriptor = describeCloudAssetWrite(input)
      const mimeType = inferMimeType(input.blob, input.fileName)
      const created = await options.createUpload({
        projectId: descriptor.projectId,
        originalFileName: input.fileName,
        mimeType,
        byteSize: input.blob.size,
        ...(input.width ? { width: input.width } : {}),
        ...(input.height ? { height: input.height } : {}),
        assetKind: descriptor.assetKind,
        referenceRole: descriptor.referenceRole,
        idempotencyKey: `asset_upload_${createId()}`,
      })

      const directUploadExpiresAt = Date.parse(created.directUpload.expiresAt)
      if (
        created.upload.assetId !== created.asset.id
        || created.upload.status !== 'pending'
        || created.asset.status !== 'pending'
        || !isHttpUrl(created.directUpload.url)
        || !Number.isFinite(directUploadExpiresAt)
        || directUploadExpiresAt <= now()
      ) {
        throw new Error('Cloud 上传会话响应无效')
      }

      const directResponse = await fetchDirectUpload(created.directUpload.url, {
        method: created.directUpload.method,
        headers: created.directUpload.headers,
        body: input.blob,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      })
      if (!directResponse.ok) {
        throw new Error(`对象存储直传失败（HTTP ${directResponse.status}）`)
      }

      const completed = await options.completeUpload(created.upload.id)
      if (
        completed.upload.id !== created.upload.id
        || completed.upload.assetId !== created.asset.id
        || completed.upload.status !== 'completed'
        || completed.asset.id !== created.asset.id
        || completed.asset.status !== 'completed'
      ) {
        throw new Error('Cloud 上传完成确认响应无效')
      }

      return {
        assetId: completed.asset.id,
        projectId: completed.asset.projectId,
        assetKind: completed.asset.assetKind,
        relativePath: createCloudAssetRelativePath(completed.asset.id),
        fileName: completed.asset.originalFileName ?? input.fileName,
        mimeType: completed.asset.mimeType,
      }
    },
  }
}
