import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import {
  ASSET_UPLOAD_MAX_BYTES,
  createUnavailableAssetService,
  validateCreateAssetUploadRequest,
} from '../../dist/modules/assets/service.js'
import { createS3ObjectStorage } from '../../dist/modules/assets/s3ObjectStorage.js'

test('asset upload request validation normalizes safe metadata', () => {
  const request = validateCreateAssetUploadRequest({
    projectId: '11111111-1111-4111-8111-111111111111',
    originalFileName: ' reference.PNG ',
    mimeType: ' IMAGE/PNG ',
    byteSize: 1024,
    sha256: 'A'.repeat(64),
    width: 512,
    height: 256,
    assetKind: 'upload',
    referenceRole: 'source',
    idempotencyKey: ' asset_upload_1 ',
  })

  assert.equal(request.projectId, '11111111-1111-4111-8111-111111111111')
  assert.equal(request.originalFileName, 'reference.PNG')
  assert.equal(request.mimeType, 'image/png')
  assert.equal(request.sha256, 'a'.repeat(64))
  assert.equal(request.idempotencyKey, 'asset_upload_1')
})

test('asset upload request validation rejects unsafe or oversized inputs', () => {
  assert.throws(
    () => validateCreateAssetUploadRequest({
      originalFileName: '../secret.png',
      mimeType: 'image/png',
      byteSize: 1024,
      assetKind: 'upload',
      idempotencyKey: 'asset_upload_1',
    }),
    /path separators/,
  )

  assert.throws(
    () => validateCreateAssetUploadRequest({
      originalFileName: 'payload.svg',
      mimeType: 'image/svg+xml',
      byteSize: 1024,
      assetKind: 'upload',
      idempotencyKey: 'asset_upload_1',
    }),
    /mimeType is not allowed/,
  )

  assert.throws(
    () => validateCreateAssetUploadRequest({
      originalFileName: 'huge.png',
      mimeType: 'image/png',
      byteSize: ASSET_UPLOAD_MAX_BYTES + 1,
      assetKind: 'upload',
      idempotencyKey: 'asset_upload_1',
    }),
    /byteSize/,
  )

  assert.throws(
    () => validateCreateAssetUploadRequest({
      originalFileName: 'bad.png',
      mimeType: 'image/png',
      byteSize: 1024,
      sha256: 'not-a-digest',
      assetKind: 'upload',
      idempotencyKey: 'asset_upload_1',
    }),
    /sha256/,
  )
})

test('unavailable asset service reports service unavailable', async () => {
  const service = createUnavailableAssetService()

  await assert.rejects(
    () => service.createUpload({
      originalFileName: 'reference.png',
      mimeType: 'image/png',
      byteSize: 1024,
      assetKind: 'upload',
      idempotencyKey: 'asset_upload_1',
    }, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }),
    (error: unknown) => {
      assert(error instanceof AuthServiceError)
      assert.equal(error.apiCode, 'SERVICE_UNAVAILABLE')
      return true
    },
  )

  await assert.rejects(
    () => service.completeUpload('55555555-5555-4555-8555-555555555555', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }),
    (error: unknown) => {
      assert(error instanceof AuthServiceError)
      assert.equal(error.apiCode, 'SERVICE_UNAVAILABLE')
      return true
    },
  )
})

test('S3 object storage creates MinIO-compatible presigned PUT URLs without exposing secrets', async () => {
  const storage = createS3ObjectStorage({
    endpoint: 'http://localhost:9000',
    bucket: 'ai-canvas-cloud',
    region: 'local',
    accessKeyId: 'local-access-key',
    secretAccessKey: 'local-secret-key',
    forcePathStyle: true,
  })

  const upload = await storage.createPresignedUpload({
    objectKey: 'workspaces/workspace-1/projects/project-1/uploads/asset-1.png',
    mimeType: 'image/png',
    byteSize: 1024,
    expiresInSeconds: 900,
  })

  assert.equal(upload.method, 'PUT')
  assert.equal(upload.headers['content-type'], 'image/png')
  assert.match(upload.url, /^http:\/\/localhost:9000\/ai-canvas-cloud\//)
  assert.match(upload.url, /X-Amz-Signature=/)
  assert.equal(upload.url.includes('local-secret-key'), false)
})
