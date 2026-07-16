import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AssetUploadResponse,
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
} from '@ai-canvas-cloud/contracts'
import {
  createCloudAssetUploader,
  describeCloudAssetWrite,
} from './cloudAssetUpload.ts'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const UPLOAD_ID = '55555555-5555-4555-8555-555555555555'
const ASSET_ID = '66666666-6666-4666-8666-666666666666'
const NOW = Date.parse('2026-07-16T00:00:00.000Z')

function createUploadResponse(input: CreateAssetUploadRequest): AssetUploadResponse {
  const createdAt = new Date(NOW).toISOString()
  const expiresAt = new Date(NOW + 15 * 60_000).toISOString()

  return {
    upload: {
      id: UPLOAD_ID,
      assetId: ASSET_ID,
      projectId: input.projectId ?? null,
      originalFileName: input.originalFileName,
      expectedMimeType: input.mimeType,
      expectedByteSize: input.byteSize,
      expectedSha256: input.sha256 ?? null,
      assetKind: input.assetKind,
      status: 'pending',
      expiresAt,
      createdAt,
    },
    asset: {
      id: ASSET_ID,
      projectId: input.projectId ?? null,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256 ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      assetKind: input.assetKind,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    },
    directUpload: {
      method: 'PUT',
      url: 'http://object-storage.test/private-upload',
      headers: { 'content-type': input.mimeType },
      expiresAt,
    },
  }
}

function completeUploadResponse(created: AssetUploadResponse): CompleteAssetUploadResponse {
  return {
    upload: { ...created.upload, status: 'completed' },
    asset: { ...created.asset, status: 'completed' },
  }
}

test('cloud asset writes derive project, kind, and reference role from stable client paths', () => {
  const image = new Blob(['image'], { type: 'image/png' })
  const video = new Blob(['video'], { type: 'video/mp4' })

  assert.deepEqual(describeCloudAssetWrite({
    pathSegments: ['projects', PROJECT_ID, 'generated', '2026-07-16'],
    fileName: 'result.png',
    blob: image,
  }), {
    projectId: PROJECT_ID,
    assetKind: 'generated',
    referenceRole: 'result',
  })
  assert.deepEqual(describeCloudAssetWrite({
    pathSegments: ['projects', PROJECT_ID, 'uploads'],
    fileName: 'source.mp4',
    blob: video,
  }), {
    projectId: PROJECT_ID,
    assetKind: 'video',
    referenceRole: 'source',
  })
  assert.deepEqual(describeCloudAssetWrite({
    pathSegments: ['projects', PROJECT_ID, 'thumbnails', 'uploads'],
    fileName: 'source-thumbnail.webp',
    blob: image,
  }), {
    projectId: PROJECT_ID,
    assetKind: 'thumbnail',
    referenceRole: 'thumbnail',
  })
})

test('cloud asset uploader creates a session, uploads without cookies, and completes it', async () => {
  const createRequests: CreateAssetUploadRequest[] = []
  const directRequests: Array<{ url: string; init: RequestInit }> = []
  const completedUploadIds: string[] = []
  let created: AssetUploadResponse | null = null
  const uploader = createCloudAssetUploader({
    now: () => NOW,
    createId: () => 'request-1',
    async createUpload(input) {
      createRequests.push(input)
      created = createUploadResponse(input)
      return created
    },
    async fetchDirectUpload(url, init) {
      directRequests.push({ url, init })
      return { ok: true, status: 200 }
    },
    async completeUpload(uploadId) {
      completedUploadIds.push(uploadId)
      assert(created)
      return completeUploadResponse(created)
    },
  })
  const blob = new Blob(['image-content'], { type: 'image/png' })

  const result = await uploader.upload({
    pathSegments: ['projects', PROJECT_ID, 'uploads'],
    fileName: 'reference.png',
    blob,
    width: 1024,
    height: 768,
  })

  assert.deepEqual(createRequests, [{
    projectId: PROJECT_ID,
    originalFileName: 'reference.png',
    mimeType: 'image/png',
    byteSize: blob.size,
    width: 1024,
    height: 768,
    assetKind: 'upload',
    referenceRole: 'source',
    idempotencyKey: 'asset_upload_request-1',
  }])
  assert.equal(directRequests.length, 1)
  assert.equal(directRequests[0].url, 'http://object-storage.test/private-upload')
  assert.equal(directRequests[0].init.method, 'PUT')
  assert.equal(directRequests[0].init.body, blob)
  assert.equal(directRequests[0].init.credentials, 'omit')
  assert.equal(directRequests[0].init.redirect, 'error')
  assert.deepEqual(completedUploadIds, [UPLOAD_ID])
  assert.deepEqual(result, {
    assetId: ASSET_ID,
    projectId: PROJECT_ID,
    assetKind: 'upload',
    relativePath: `cloud-assets/${ASSET_ID}`,
    fileName: 'reference.png',
    mimeType: 'image/png',
  })
})

test('cloud asset uploader does not confirm a failed direct upload', async () => {
  let completeCount = 0
  const uploader = createCloudAssetUploader({
    now: () => NOW,
    async createUpload(input) {
      return createUploadResponse(input)
    },
    async fetchDirectUpload() {
      return { ok: false, status: 403 }
    },
    async completeUpload() {
      completeCount += 1
      throw new Error('completeUpload should not run')
    },
  })

  await assert.rejects(
    () => uploader.upload({
      pathSegments: ['projects', PROJECT_ID, 'uploads'],
      fileName: 'reference.png',
      blob: new Blob(['image'], { type: 'image/png' }),
    }),
    /HTTP 403/,
  )
  assert.equal(completeCount, 0)
})
